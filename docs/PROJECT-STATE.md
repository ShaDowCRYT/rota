# Project state

Last updated: 2026-11-25

## Current position

Phase 1 (auth and teams) is complete. The server side of Phase 2 (shifts and feed) and Phase 3 (swap requests) is complete.

The app now has the week schedule, Members tab, shift create/edit/detail/delete, Activity tab, and Swaps tab. The Phase 2 exit check is met. The full Phase 3 exit check is **not met** because offline swap state and the airplane-mode demo are deliberately deferred to Phase 4 (decision `0024`). Push notifications are also deferred to Phase 4.

## Verification evidence

`node scripts/verify.mjs` was run after the code changes: **11 of 11 checks PASS**.

| Check | Result |
|---|---|
| Server build, type check, lint | PASS |
| Server tests | 19 files, 197 tests passed |
| App type check, lint | PASS |
| App tests | 23 files, 127 tests passed |
| Secret scans (tracked `.env`, credential strings, ignore rules) | PASS |
| Server tests with no settings and no `.env` | 19 files, 197 tests passed |

The app type check, lint, and 127 tests also passed directly before verification with local `.env` files hidden and Expo public env vars cleared. The final verification run passed all 11 checks.

## What this slice delivered

- Restored Members tab: team name, member list, role change, remove with confirmation, invite create/share/revoke, one-time link, 404 redirect home, loading/empty/error/retry states.
- Schedule tab: Monday-based week nav, shift cards with local times and swap labels, Create shift, View shift details, and role-aware Edit/Delete.
- Shift create/edit/delete: own 14-day chips, 15-minute time chips, end-after-start validation, member assignment, friendly 409 overlaps, confirmations, all targets at least 44 points.
- Activity tab: FlashList infinite query, cursor pages requested one at a time, pages merged by id, pull to refresh, first-page retry, later-page retry, "You are all caught up", sentences built from member emails.
- Swaps: request to one teammate or open to team with optimistic "Swap requested", rollback on failure, double-tap guard, cancel, approve/reject with inline confirmations, and assignee choice for open requests.
- Friendly server messages: overlap, already decided, and already requested no longer show raw provider or database text.
- Phone bug fix: id-based team calls reject non-UUID values before fetch, GET 400 uses the generic read message, dev warnings include endpoint template/status/method only, and the invite button stays visible for owners even if the team-name read fails.
- Route bug fix: team layout screens now match real route files, with `src/test/routes.test.ts` checking root/team/tab layouts without a device.
- Shared team id fix: `team/[teamId]/_layout.tsx` validates the route id once, supplies it through `TeamIdProvider`, and shows a friendly Back screen when the id is invalid. All team screens read that shared id through `useTeamId`.
- Members access helpers with tests: invite button only for the owner, member actions only for non-owner members, optional invite email normalization, and share message.
- Pure app helpers with tests: error mapping, date/time, feed merge and event text, swap optimistic cache, submit guard, and in-memory notice store.
- `docs/STATE.md` maps every important piece of data to TanStack Query, Zustand, SecureStore, or the server, with stale/gc times.
- Decision record: `docs/decisions/0024-app-screens-and-state.md`.

## Known limits (deliberately deferred)

- Offline swap state and airplane-mode behavior are not built; Phase 3 exit check is still not met.
- Push notifications are not queued. Phase 4 must send them from BullMQ jobs and respect quiet hours.
- The shard router still has one database entry. Two real shard databases come in Phase 6.
- Invites still return a deep link; sending invitation email is not built.
- Sentry is on the server only. App Sentry is still to do.
- The README demo GIF, build download, and demo video are still placeholders.
- FlashList 2.x measures rows itself; no `estimatedItemSize` prop is used.

## Next phase

Billing first (Phase 5): plans, proration, Flutterwave test mode, webhooks, ledger, and seat limits. Then Phase 4: settings sync, push notifications and quiet hours, offline shifts, Android development build, app Sentry, and demo links.

## Reminders

- Keep writing a short entry in `docs/LEARNING-LOG.md` in your own words after each AI-assisted feature.
- The developer updates the "Current phase" line in `AGENTS.md` when moving to the next phase.
- Do not commit or push unless asked.
