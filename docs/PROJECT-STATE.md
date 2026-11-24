# Project state

Last updated: 2026-11-24

## Current position

Phase 1 (auth and teams) is complete. Phase 2 (shifts and feed) is the next phase to build.

The PRD exit check for Phase 1 is "Auth and isolation tests pass" (`docs/Rota-PRD.md`, section 11). That check is met.

## Verification evidence

`node scripts/verify.mjs` run on 2026-11-24: **11 of 11 checks PASS**.

| Check | Result |
|---|---|
| Server build, type check, lint | PASS |
| Server tests | 16 files, 140 tests passed |
| App type check, lint | PASS |
| App tests | 10 files, 60 tests passed |
| Secret scans (tracked `.env`, credential strings, ignore rules) | PASS |
| Server tests with no settings and no `.env` | 16 files, 140 tests passed |

## What Phase 1 delivered

- Email and password sign-up, login, `GET /me`, password hashing, short-lived access tokens, and Redis rate limits.
- Rotating refresh tokens, reuse detection with family revocation, logout, and logout-all.
- Server-side teams, membership roles, permission checks, and team isolation on every team query.
- Single-use invite and password-reset tokens, invite acceptance, and deep links in the app.
- Google sign-in: the app sends the ID token only to the Rota server, which verifies it and issues Rota tokens.
- App screens for sign-up, login, account, teams, invites, password reset, and deep-link handling.
- Global and shard table groups with a single-entry shard router for local development.
- Decision records for the choices made; see `docs/decisions/`.

## Known limits (deliberately deferred)

- The shard router has one database entry. Two real shard databases come in Phase 6.
- Invites return a deep link; sending invitation email is not built.
- Sentry is on the server only. App Sentry is still to do.
- No shifts, feed, swaps, settings, push, or billing screens yet; those are later phases.
- The README demo GIF, build download, and demo video are still placeholders.

## Next phase

Phase 2: shifts and feed. Scope from the PRD is F3, seed 10,000 records, add an index, and run `EXPLAIN ANALYZE`. Exit check: cursor tests pass.

## Reminders

- Keep writing a short entry in `docs/LEARNING-LOG.md` in your own words after each AI-assisted feature.
- The developer updates the "Current phase" line in `AGENTS.md` when moving to the next phase.
