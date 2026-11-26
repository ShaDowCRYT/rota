# 0027: Billing Core (Slice 8a)

## Status

Accepted

## Context

Phase 5 requires a server-only billing core before the payment provider or webhooks. The slice must enforce BILL-1, BILL-2, BILL-6, and BILL-7 with no UI, no Flutterwave, and no background jobs.

## Decision

- Money stays as integer cents in TypeScript and Postgres integer columns. Proration is a pure function in `server/src/modules/billing/proration.ts` with injected inputs and no DB/network/date reads.
- `quoteChange` uses PRD 4.2 formulas, divides last, and uses `Math.floor`. Period math uses 30-day periods and `daysLeft = max(1, 30 - floor(elapsed whole days))`.
- Plans are seeded in the global `plans` table: Starter 2000/5/no extra/5 max, Team 5000/15/300/25 max, Business 12000/40/200/100 max.
- Subscriptions and ledger entries live in the shard schema by `team_id`. `plan_id` is plain text/UUID data, not a cross-database foreign key.
- `ledger_entries` is append-only. A Postgres trigger rejects UPDATE/DELETE. A partial unique index enforces `(team_id, idempotency_ref)` when `idempotency_ref` is present.
- No subscription row means status `none` with Starter limits: 5 seats, read-only-style billing status data, nothing locked by this slice.
- Seat enforcement uses `assertSeatAvailable(teamId)` from teams invite creation/acceptance. Seats used = active memberships + unexpired unused invites. The check is protected by a short Redis lock per team to prevent race over-allocation; Redis failure fails closed with 503.
- Billing routes are owner-only and expose status, plans, and quote. Quote is rate-limited with the existing Redis fixed-window limiter.

## Consequences

- Later payment/webhook slices can reuse proration, ledger append, and seat checks without changing money math.
- Real-DB proof required disabling the append-only trigger only for test cleanup; production behavior remains append-only.
- Seat checks depend on Redis for race safety; this matches the project's Redis-as-infrastructure rule and fail-closed behavior.
