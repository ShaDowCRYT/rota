# Billing (Slice 8b)

Phase 5 billing core and Flutterwave test-mode payment pipeline. Plans, proration, and seat limits were built in slice 8a; this slice adds checkout, verified webhooks, background jobs, idempotency, the append-only ledger, and restart recovery.

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

## Routes (owner only)

- `GET /teams/:teamId/billing` - status from subscription plus latest payment.
- `GET /teams/:teamId/billing/plans` - plan list.
- `POST /teams/:teamId/billing/quote` - validates, rate-limited, no payment/state mutation.
- `POST /teams/:teamId/billing/checkout` - requires `Idempotency-Key`; creates payment and checkout URL.
- `POST /teams/:teamId/billing/schedule-change` - requires `Idempotency-Key`; writes a scheduled change at period end.
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
3. Only `charge.completed` events with a valid `rota.<teamId>.<paymentId>` `tx_ref` are stored. Other valid webhooks return `{ "status": "ignored" }` with 200.
4. `webhook_events.event_key` is the primary key. A duplicate returns `{ "status": "duplicate" }`; it is re-enqueued only when `processed_at` is still null.
5. The job calls Flutterwave verify, compares `tx_ref`, integer cents, and currency, then claims the payment with a conditional update. Mismatches mark the payment failed with no ledger rows.
6. Provider failures throw so BullMQ retries with exponential backoff (8 attempts, 5 second base delay, failed list retained).
7. On startup, `reenqueueUnprocessedWebhookEvents` queues unprocessed events from all shards, oldest first, up to 100 by default.

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
```

`--quick` uses 5 simultaneous jobs over 2 rounds. `--full` uses **50 simultaneous jobs over 5 rounds**. Every run has a random suffix; team names start with `proof-` and user emails end with `@proof.invalid`. Database errors print only `code`, `constraint`, and `table` from `error.cause`, never query parameters.

Cleanup deletes only webhook events, payments, idempotency keys, activity events, invites, and users/memberships with no ledger rows. Their `user_teams` lookup rows are removed only where needed to delete those users. Teams that own ledger rows stay in place, marked by their `proof-` name. The script logs `teams_with_ledger_left`. The amount mismatch measurement uses a fresh proof team with only the mismatch event; the required result is `amount_mismatch_ledger_rows: 0`.
