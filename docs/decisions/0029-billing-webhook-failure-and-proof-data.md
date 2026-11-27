# 0029: Billing webhook failure behavior and proof data

## Status

Accepted

## Date

2026-11-27

## Context

Slice 8b added Flutterwave test-mode checkout, verified webhooks, BullMQ jobs, the append-only ledger, and restart recovery. A timed-out proof run left a reusable fixed event key in `webhook_events`. The next run crashed on a duplicate primary-key insert. The raw Drizzle error printed the whole failed query with its parameters, so the cause was hidden inside `error.cause`.

## Decision

- The webhook rate limit **fails open only when Redis returns 503**. A 429 still blocks the request. This is an exception to decision 0013 for this route only, because a missed webhook can be retried by the provider and re-enqueued from the database on startup.
- The append-only trigger `ledger_entries_append_only` was verified **ENABLED** after the timed-out run and after cleanup. Cleanup never disables, alters, or recreates it; no SQL in the proof script touches the trigger.
- Proof data is **marked and left in place** where the database rules require it. Teams whose names start with `proof-` and that own ledger rows remain, together with their membership and user records. Cleanup deletes only `webhook_events`, `payments`, `idempotency_keys`, `activity_events`, `invites`, and users/memberships with no ledger rows. Their `user_teams` lookup rows are removed only where needed to delete those users. The script prints `teams_with_ledger_left`.
- Database errors are printed with a safe formatter: only `code`, `constraint`, and `table` from `error.cause`. Query text and parameters are never printed, because values can be personal data or secrets.
- Every proof run uses a random suffix on IDs and event keys. Team names start with `proof-` and user emails end with `@proof.invalid`. `--quick` uses smaller bursts; `--full` uses 50 simultaneous jobs over 5 rounds.
- Flutterwave may send either the modern shape (`event: "charge.completed"` plus `data.id`, `data.tx_ref`) or the older flat shape (`"event.type": "CARD_TRANSACTION"` plus top-level `id`, `txRef`). Only the Flutterwave adapter reads those provider field names. Both shapes normalize to provider transaction ID, tx ref, and event name; legacy charge events count as `charge.completed`.
- The webhook body is never trusted for money. Its status is used only in `charge.completed:<providerTxId>:<status>` (or `unknown` when absent) as a dedupe key. The worker calls `GET /v3/transactions/{id}/verify` and compares status, integer cents, currency, and tx ref before any ledger or subscription change.
- Ignored webhook diagnostics log only top-level field names, `data` field names, and a short event label made of letters, dots, and underscores. Body values, headers, hashes, keys, and tokens are never logged.

## Why

- Failing open on a Redis outage keeps the payment pipeline available; event-key uniqueness and startup re-enqueue still prevent double processing. Failing closed would delay a legitimate payment notification.
- The ledger must be append-only for BILL-6. Keeping the enabled trigger is stronger than deleting rows to make a script pass.
- Marked leftover teams are useful evidence of a real append-only ledger and cannot be confused with normal team data.
- The wrapped database error was the real clue: the outer message showed a failed insert with parameters, while `error.cause` held `23505`, `webhook_events_pkey`, and `webhook_events`.
- A 200 from Flutterwave only proves delivery. It does not prove shape or payment success, so both known shapes must be parsed before the event can be stored and queued.

## Consequences

- A future change must preserve the fail-open exception only for `/webhooks/flutterwave`; all other rate-limited routes keep failing closed.
- Proof runs accumulate ledger-owning `proof-` teams. They are intentionally not deleted and must not be used for product data.
- Logs stay safe, but they no longer include the failed SQL. Reproduce locally with a fresh proof team if a constraint name is needed.
- A new Flutterwave payload shape needs a parser change in the adapter only, never in the webhook route or worker.
