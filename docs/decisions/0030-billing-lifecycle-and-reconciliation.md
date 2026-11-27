# 0030: Billing lifecycle, renewal reconciliation, and restricted access

## Status

Accepted

## Date

2026-11-27

## Context

Phase 5 needs subscriptions to renew, owners to be warned before access is restricted, and unpaid payments to be recovered when a webhook is missed. The Render free service can sleep, so a scheduler alone can leave a team overdue until the next tick. Hosted checkout cannot charge a stored card, so a renewal needs an owner payment link.

## Decision

- Time is always injected. The state machine, maintenance job, workers, and services take a `now` function. They never call `Date.now()` or `new Date()` themselves. Production passes `() => new Date()` at the edge.
- `server/src/modules/billing/lifecycle.ts` is a pure function. It maps `active` to `past_due` at `period_end`, creates one renewal quote, sets `grace_ends_at` to `period_end + 5 days`, sends notices at day 0, 3, and 5, then maps `past_due` to `restricted`.
- A successful renewal starts a new 30-day period at the old `period_end`. A failed renewal never adds a ledger row.
- One BullMQ job scheduler named `billing-maintenance` runs every 15 minutes with `upsertJobScheduler` from `https://docs.bullmq.io/guide/job-schedulers/`. One startup job runs when the worker boots, so a sleeping Render service catches up immediately. Each run processes at most 100 subscriptions, 100 stale renewals, and 100 renewals needing checkout.
- Upstash command estimate for the maintenance worker: about 3,500 commands per day. That is about 2,880 blocked worker polls with a 30-second `drainDelay`, plus roughly 600 commands for the 96 scheduled jobs and their completion records. The webhook worker has its own separate polling cost.
- Reconciliation is a safety net, not a replacement for webhooks. Every 15 minutes, pending renewal payments older than 15 minutes are verified by `tx_ref` through `GET /v3/transactions/verify_by_reference?tx_ref=...`. The current Flutterwave docs are `https://developer.flutterwave.com/reference/verify-transaction-with-tx_ref` and `https://developer.flutterwave.com/docs/transaction-verification`. The adapter checks `status`, `tx_ref`, currency, and integer cents. Only the provider adapter knows those field names.
- Webhook processing and reconciliation call the same `applyVerifiedPayment` function. A payment can update the ledger and subscription only once, whether the webhook arrives first or the scheduler notices first.
- Duplicate initial payments are accepted, recorded with a zero-value adjustment, and flagged for review. They never grant another month. Overpayments are accepted at the quoted amount and flagged `needsReview` with the provider amount stored in the payment quote; refunds are handled manually.
- Restricted access is enforced on the server for every team-writing route for shifts, swaps, invites, and members. A restricted team returns 402 `This team's subscription needs attention`. Read routes still work. Billing routes remain available to the owner so the owner can pay. Staff billing status never includes `amountDueCents` or `renewalCheckoutUrl`.
- `GET /teams/:teamId/billing` is readable by every confirmed member. Other billing routes stay owner-only.
- `POST /teams/:teamId/billing/renewal-checkout` validates a payment UUID with Zod, uses the owner email from the authenticated user, and stores one checkout URL. Its idempotency key is derived from the renewal payment ID.
- The proof script uses real PostgreSQL and Redis with a fake payment provider. It is server-only and never prints secrets, keys, tokens, or query parameters.

## Why

- Injected time makes the grace-period rules testable with no environment variables and no waiting in real time.
- Startup catch-up is required because a sleeping Render service misses scheduled ticks while asleep.
- One apply function prevents two separate code paths from disagreeing about money, ledger rows, or subscription state.
- Restricted access must be checked on the server; hiding app buttons would protect nothing.
- Owner-only renewal checkout keeps payment links away from staff while still letting staff read their schedule.

## Consequences

- A new team write route must include `requireWritableTeam` or it will keep working during restriction.
- The ledger remains append-only. Duplicate and overpayment corrections are new rows or review flags, never updates to old ledger rows.
- Upstash command use grows with the number of workers. If commands approach the free limit, raise `drainDelay` with a new decision before changing locked packages.
- Manual refunds are outside the app. The server records `needsReview` only.
