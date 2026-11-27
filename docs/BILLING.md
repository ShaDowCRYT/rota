# Billing (Slice 8c)

Phase 5 billing core, Flutterwave test-mode payment pipeline, and subscription lifecycle. Plans, proration, and seat limits were built in slice 8a; slice 8b added checkout, verified webhooks, jobs, idempotency, the append-only ledger, and restart recovery. This slice adds renewals, grace periods, restricted access, and reconciliation.

## Plans

Seeded in global `plans` table (integer cents):

| Plan | Price | Included seats | Extra seat | Max seats |
|---|---:|---:|---:|---:|
| Starter | 2000 | 5 | unavailable | 5 |
| Team | 5000 | 15 | 300 | 25 |
| Business | 12000 | 40 | 200 | 100 |

`monthlyTotal = price_cents + max(0, seats - included) * extra_seat_cents`. Starter seats must be exactly 5.

## Proration

Pure function `quoteChange` in `server/src/modules/billing/proration.ts`. Inputs are injected; no DB/network/Date.now. All money integer cents, divide last, `Math.floor`.

- `daysLeft = max(1, 30 - floor(elapsed whole days))`
- `credit = floor(oldMonthly * daysLeft / 30)`
- `cost = floor(newMonthly * daysLeft / 30)`
- Upgrade/higher monthly total: immediate, `charge = cost - credit`
- Downgrade/seat removal: scheduled at period end, charge 0, no refund

## Routes

- `GET /teams/:teamId/billing` - any confirmed member can read status. Staff never receive `amountDueCents` or `renewalCheckoutUrl`.
- `GET /teams/:teamId/billing/plans` - owner-only plan list.
- `POST /teams/:teamId/billing/quote` - owner-only, validates, rate-limited, no payment/state mutation.
- `POST /teams/:teamId/billing/checkout` - owner-only, requires `Idempotency-Key`; creates payment and checkout URL.
- `POST /teams/:teamId/billing/schedule-change` - owner-only, requires `Idempotency-Key`; writes a scheduled change at period end.
- `POST /teams/:teamId/billing/renewal-checkout` - owner-only, validates a renewal `paymentId`; creates or returns one checkout URL.
- `GET /billing/return` - redirect target. It only tells the user to return to the app; it never marks a payment paid.
- `POST /webhooks/flutterwave` - verifies `verif-hash`, stores event, queues job, returns fast.

All money responses are integer cents. Routes validate body, query, params, and headers with Zod. Role checks use the membership in the database on every request.

## Text sequence diagram

```text
Owner app          Rota API             Flutterwave        Webhook route        BullMQ worker          Database
    |                  |                      |                   |                    |                   |
    |-- checkout ----->|                      |                   |                    |                   |
    |                  |-- verify idempotency |                   |                    |---- payment ------>|
    |                  |-- create checkout -->|                   |                    |                   |
    |<-- checkoutUrl --|                      |                   |                    |                   |
    |-- pay in test--->|--------------------->|                   |                    |                   |
    |<-- redirect -----|<---------------------|                   |                    |                   |
    |                  |                      |-- webhook + hash->|                    |                   |
    |                  |                      |                   |-- verify hash     |                   |
    |                  |                      |                   |-- store event ----|------------------>|
    |                  |                      |                   |-- queue job ------>|                   |
    |<-- 200 queued ---|----------------------|<------------------|                    |                   |
    |                  |                      |                   |                    |-- verify tx ----->|
    |                  |                      |<------------------|--- verify ---------|                   |
    |                  |                      |                   |                    |-- check amount,   |
    |                  |                      |                   |                    |   currency, txRef |
    |                  |                      |                   |                    |-- append ledger ->|
    |                  |                      |                   |                    |-- upsert sub ---->|
    |-- GET billing -->|                      |                   |                    |                   |
    |<-- active -------|<---------------------|-------------------|--------------------|<------------------|
```

The redirect never decides success. Only the verified webhook job can mark a payment `succeeded`, append ledger rows, and activate the subscription.

## Webhook pipeline

1. `billingWebhookRateLimit` runs first. It fails open only when Redis is unavailable (503); 429 still blocks. All other rate limits fail closed (decision 0013).
2. `verifyWebhookAuth` checks `verif-hash` before the body is parsed or stored. Bad hash returns 401.
3. The Flutterwave adapter accepts both modern and legacy charge payloads. Events with a valid `rota.<teamId>.<paymentId>` `tx_ref` are stored. Other valid webhooks return `{ "status": "ignored" }` with 200 and log a safe shape diagnostic.
4. `webhook_events.event_key` is the primary key. A duplicate returns `{ "status": "duplicate" }`; it is re-enqueued only when `processed_at` is still null.
5. The job calls Flutterwave verify, compares `tx_ref`, integer cents, and currency, then claims the payment with a conditional update. Mismatches mark the payment failed with no ledger rows.
6. Provider failures throw so BullMQ retries with exponential backoff (8 attempts, 5 second base delay, failed list retained).
7. On startup, `reenqueueUnprocessedWebhookEvents` queues unprocessed events from all shards, oldest first, up to 100 by default.

### Webhook payload shapes

Only `server/src/providers/payments/flutterwave.ts` reads Flutterwave field names.

- Modern shape: `event: "charge.completed"`, `data.id`, `data.tx_ref`, optional `data.status`.
- The deployed legacy account sends a flat payload with no `data` object. Its top-level field names are exactly `IP`, `amount`, `appfee`, `charge_type`, `charged_amount`, `createdAt`, `currency`, `customer`, `entity`, `event.type`, `flwRef`, `id`, `merchantbearsfee`, `merchantfee`, `orderRef`, `paymentPage`, `paymentPlan`, `status`, `txRef`.
- The legacy event type is the literal top-level key `"event.type"` with dot notation. Accepted legacy values start with `CARD_TRANSACTION` or end with `_TRANSACTION`, so `CARD_TRANSACTION` and `BANK_TRANSFER_TRANSACTION` are charge events but `TRANSFER` and `TRANSFER_COMPLETED` are ignored.
- Legacy `id` must be a positive integer or a numeric string; it is normalized with `String(id)`. Legacy `txRef` must parse as `rota.<teamId>.<paymentId>` where both IDs are UUIDs.
- Both shapes normalize to provider transaction ID, tx ref, and event name. Legacy charge events are treated like `charge.completed`.
- `event_key` is `charge.completed:<providerTxId>:<status>`, with `unknown` when the body status is missing or is not a short letters-only string. The body status is only a dedupe label.
- The webhook body is never trusted for money. `body.status`, `body.amount`, and `body.currency` never decide payment success. The worker verifies with `GET /v3/transactions/{id}/verify` and compares status, integer cents, currency, and `data.tx_ref` before any ledger, payment, or subscription change.
- Ignored webhooks log only top-level field names, `data` field names, and a short event label. For the deployed legacy shape, `dataKeys` is empty. Body values, headers, hashes, keys, and tokens are never logged.

## Subscription lifecycle

The state machine is pure: `nextState({ subscription, now })`. Time is injected everywhere; no state-machine, job, or service calls `Date.now()`.

```text
active -- period_end reached --> past_due -- grace day 5 --> restricted
   ^                                 |
   |                                 | verified renewal payment
   +---------------------------------+
```

- At `period_end`, pending plan and seats become the next period's plan and seats. One renewal payment is created for the full monthly total. The old `period_end` becomes the new `period_start`.
- Grace is 5 days. The owner gets activity events and emails on day 0, day 3, and day 5.
- On day 5 the team becomes `restricted`. Team writes for shifts, swaps, invites, and members return 402. Reads keep working, and the owner can still use billing routes.
- A verified renewal appends one `renewal` ledger row and resets the subscription to `active` for 30 days.

## Maintenance scheduler

- One BullMQ scheduler name: `billing-maintenance`. It runs every 15 minutes with `upsertJobScheduler` from `https://docs.bullmq.io/guide/job-schedulers/`.
- One startup job catches up after the sleeping Render service wakes.
- Each run checks at most 100 subscriptions, 100 stale renewal payments, and 100 renewals needing checkout.
- The injected clock and startup catch-up were chosen in decision `0030`.

## Reconciliation and duplicate payments

- Webhook jobs and the scheduler call the same `applyVerifiedPayment` function.
- A stale pending renewal is verified by `tx_ref` with `GET /v3/transactions/verify_by_reference?tx_ref=...`. Current Flutterwave docs: `https://developer.flutterwave.com/reference/verify-transaction-with-tx_ref` and `https://developer.flutterwave.com/docs/transaction-verification`.
- Verification checks `status`, `tx_ref`, integer cents, and currency. A mismatch marks the payment failed and writes no ledger rows.
- A duplicate initial payment is recorded with a zero-value `adjustment` and `needsReview`; it never grants another period.
- An overpayment is accepted at the quoted amount. The provider amount is stored in the payment quote with `needsReview` for a manual refund.
- A renewal needs the owner to pay through hosted checkout; the app cannot charge a stored card.

## Ledger and recovery

- Shard tables by `team_id`: `teams`, `memberships`, `activity_events`, `subscriptions`, `ledger_entries`, `payments`, `webhook_events`.
- Global tables: `users`, `refresh_tokens`, `devices`, `settings`, `plans`, `invites`, `idempotency_keys`, `user_teams`.
- `ledger_entries` is append-only via trigger `ledger_entries_append_only`; corrections are new rows. Cleanup code never disables or alters this trigger.
- Subscription state is rebuildable from ordered ledger entries. Proof run 8b reports `rebuild_match: 1`.
- Never cache subscriptions, payment status, credit balances, webhook events, or idempotency records.

## Seat limits

`assertSeatAvailable(teamId)` counts memberships plus unexpired unused invites. Missing subscription uses 5 seats. Over limit returns 409 `Seat limit reached for this plan`. Redis lock per team prevents race over-allocation; Redis failure returns 503.

## Proof script

From the `server` folder:

```bash
npx tsx scripts/billing-pipeline-check.ts --quick
npx tsx scripts/billing-pipeline-check.ts --full
npx tsx scripts/lifecycle-check.ts --quick
npx tsx scripts/lifecycle-check.ts --full
```

`--quick` uses 5 simultaneous jobs over 2 rounds. `--full` uses **50 simultaneous jobs over 5 rounds**. Every run has a random suffix; team names start with `proof-` and user emails end with `@proof.invalid`. Database errors print only `code`, `constraint`, and `table` from `error.cause`, never query parameters.

Cleanup deletes only webhook events, payments, idempotency keys, activity events, invites, and users/memberships with no ledger rows. Their `user_teams` lookup rows are removed only where needed to delete those users. Teams that own ledger rows stay in place, marked by their `proof-` name. The script logs `teams_with_ledger_left`. The amount mismatch measurement uses a fresh proof team with only the mismatch event; the required result is `amount_mismatch_ledger_rows: 0`.

`lifecycle-check.ts` uses real PostgreSQL and Redis with a fake payment provider. It moves proof teams' `period_end` into the past, runs maintenance at day 0, day 3, day 5, then reconciles an old pending renewal. `--quick` checks one team; `--full` checks ten. The required results are `renewal_payments_created`, `payments_reconciled`, and final `status` values of `active`. It never prints secrets, keys, tokens, or query parameters.
