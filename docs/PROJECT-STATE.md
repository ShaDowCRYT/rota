# Project state

Last updated: 2026-11-24

## Current position

Phase 1 (auth and teams) is complete. The server side of Phase 2 (shifts and feed) and Phase 3 F4 (swap requests) is complete.

The Phase 2 exit check is met: cursor tests pass. The full Phase 3 exit check is not met because app optimistic updates, offline state, and the airplane-mode demo are still app work. Push notifications are also deferred to Phase 4.

## Verification evidence

`node scripts/verify.mjs` was run after the code changes: **11 of 11 checks PASS**.

| Check | Result |
|---|---|
| Server build, type check, lint | PASS |
| Server tests | 19 files, 197 tests passed |
| App type check, lint | PASS |
| App tests | 10 files, 60 tests passed |
| Secret scans (tracked `.env`, credential strings, ignore rules) | PASS |
| Server tests with no settings and no `.env` | 19 files, 197 tests passed |

The first verification run stopped on three lint errors. They were fixed in `newRateLimits.test.ts`, `shifts/repository.ts`, and `test/helpers.ts`; the final run passed. The real-database proof found that PostgreSQL can omit fractional seconds from timestamp text, so cursor validation now allows optional fractional seconds.

## What this slice delivered

- Shard migrations `0001` and `0002` created `shifts`, `swap_requests`, `activity_events`, and the `(team_id, created_at DESC, id DESC)` feed index.
- `GET /teams/:teamId/activity` uses keyset pagination on `(created_at, id)` with exact PostgreSQL timestamp text in an opaque cursor.
- Shift create, list, update, and delete enforce role checks, team isolation, 24-hour maximum duration, one-year lookahead, member-only assignment, and per-assignee overlap checks.
- Swap request create, list, approve, reject, and cancel enforce pending uniqueness, requester ownership, manager/owner decisions, overlap checks, and one-transaction approval.
- Swap approval and shift writes use shard transactions and advisory locks so the shift and request cannot disagree.
- Activity events are written for shift create, update, delete, swap request, decision, cancellation, and assignee-change cancellation.
- New limits cover activity feed list, shift list, and swap list. Permission tests and cross-team probes pass without the app.
- Seed script `server/scripts/seed-activity.ts` seeded 10,000 activity rows on the real team and 50,000 `seed-*` rows. Cleanup removed only the 50,000 `seed-*` rows; the real team still has 10,000 rows.
- Feed proof in `docs/perf/feed-explain.md`: before index `7.748 ms` with `Seq Scan` and `Rows Removed by Filter: 55001`; after index `0.092 ms` with `Index Scan using activity_events_team_created_id_idx`.
- Real-database proof counts: shift race `201:5, 409:95`; swap request race `201:5, 409:95`; decision race `200:5, 409:95` with `approvalWins:4`, `rejectionWins:1`, `assigneeMismatches:0`; feed walk `200:200`, 200 pages, 10,000 total and 10,000 unique IDs; Emeka case `pageOneStatuses 200:1`, `pageTwoStatuses 200:1`, 50 IDs per page, `duplicateIds:0`, `skippedIds:0`; isolation `404:13`, `403:1`; cleanup `activityEvents:10022`, `swapRequests:11`, `shifts:16`, `memberships:16`, `userTeams:16`, `teams:8`, `users:10`.
- Decision record: `docs/decisions/0023-shifts-activity-feed-and-swaps.md`.

## Known limits (deliberately deferred)

- No app screens were added, so calendar view, FlashList infinite scroll, pull to refresh, feed states, and optimistic swap UI remain unmet app requirements.
- Push notifications are not queued. Phase 4 must send them from BullMQ jobs and respect quiet hours.
- Offline and airplane-mode behavior for swaps is not built; the Phase 3 exit check is therefore not met.
- The shard router still has one database entry. Two real shard databases come in Phase 6.
- Invites still return a deep link; sending invitation email is not built.
- Sentry is on the server only. App Sentry is still to do.
- The README demo GIF, build download, and demo video are still placeholders.

## Next phase

Finish the app side before calling Phase 3 complete: shift calendar screen, activity feed with FlashList and states, swap request UI with optimistic update and rollback, and offline state demo. Then Phase 4 adds settings, push jobs, quiet hours, and the development build.

## Reminders

- Keep writing a short entry in `docs/LEARNING-LOG.md` in your own words after each AI-assisted feature.
- The developer updates the "Current phase" line in `AGENTS.md` when moving to the next phase.
