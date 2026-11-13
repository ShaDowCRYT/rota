# 0001: Decisions on the open questions in the PRD

Status: Accepted
Source: PRD section 12.3 (open questions)

## Context

The PRD left several choices open. The AI agent must not guess them, so we decide them here once.

## Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Payment provider | Flutterwave, test mode | Chosen by the developer. It sets webhook signature details. |
| 2 | Second login method | Google sign-in | Chosen by the developer. |
| 3 | Grace period on failed renewal | 5 days. Notify the owner on day 0, 3, and 5. Then restrict access (Staff read-only, Owner sees billing screen). | Fair to a small business with a bank delay. Not too long. |
| 4 | Seat caps for extra seats | Team max 25 seats. Business max 100 seats. Stored in plan config. | Stops Team growing past Business. Pushes big teams to upgrade. |
| 5 | Plan change on the last day | `daysLeft = max(1, actualDaysLeft)` | Without this, an upgrade on the last day would be free. |
| 6 | Settings sync | Refetch when the app opens or returns to the foreground | Settings rarely change. Real-time adds work for little gain. |
| 7 | Query tool | Drizzle ORM with the `pg` driver | Keeps SQL visible for `EXPLAIN ANALYZE`, cursor queries, and two databases. |
| 8 | Token lifetimes | Access 15 min. Refresh 30 days, rotated on every use. Reset 30 min, single-use. Invite 7 days, single-use. | A stolen access token works for 15 minutes at most. A reused refresh token reveals theft. |
| 9 | Global versus sharded tables | See below | A user logs in before the team is known. |

### Global database (not split by team)

`users`, `refresh_tokens`, `devices`, `settings`, `plans`, `invites`, `idempotency_keys`, `user_teams`

### Sharded by hash of `team_id`

`teams`, `memberships`, `shifts`, `swap_requests`, `activity_events`, `subscriptions`, `ledger_entries`, `webhook_events`

## Consequences

- `user_teams` (user_id, team_id) is a new lookup table. The PRD data model did not list it. It lets us find a user's teams without asking both shards.
- A user's list of teams is now a global query plus shard queries. This is one of the queries that became harder, and it must be written up in `SHARDING.md`.
- Settings can be stale until the user reopens the app. We accept this. The weakness is documented in `ARCHITECTURE.md`.
- Day 1 and last-day plan changes both need unit tests.
