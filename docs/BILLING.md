# Billing (Slice 8a)

Server-only billing core for Phase 5. No payment provider, webhooks, app UI, or jobs.

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

## Data

- Global: `plans`.
- Shard by `team_id`: `subscriptions`, `ledger_entries`.
- No cross-database foreign keys; `plan_id` is plain text.
- `ledger_entries` is append-only via trigger; corrections are new rows. Unique `(team_id, idempotency_ref)` when ref present.
- No subscription row => status `none`, Starter limits (5 seats), nothing locked.

## Seat limits

`assertSeatAvailable(teamId)` counts memberships + unexpired unused invites. Missing subscription uses 5 seats. Over limit returns 409 `Seat limit reached for this plan`. Redis lock per team prevents race over-allocation; Redis failure returns 503.

## Routes (owner only)

- `GET /teams/:teamId/billing`
- `GET /teams/:teamId/billing/plans`
- `POST /teams/:teamId/billing/quote` - validates, rate-limited, no payment/state mutation

## Rebuild

`server/scripts/rebuild-subscription.ts` rebuilds subscription state from ordered ledger entries.
