# AGENTS.md: Rota

This file tells you HOW to behave while building Rota. The PRD tells you WHAT to build.
Every rule here is an order, not a suggestion.

## 1. What this project is

Rota is a shift scheduling app for small teams (restaurants, clinics, retail). An Owner creates a team and invites staff. Managers publish shifts and approve swaps. Staff view shifts and request swaps. The team pays a monthly subscription priced per seat.

- Building: Mobile Task A, PRD Draft v1.0. The PRD is the source of truth. It lives at `docs/PRD.md`.
- If the PRD and this file disagree about what to build, stop and ask.
- Current phase: **0 Foundations** (the developer updates this line). Phases are in PRD section 11. Build ONLY the current phase. Never start work from a later phase.
- Platform: Android development build only.
- The developer is a beginner. Before each step, explain it in simple English. Explain any new term in one line. Do one task at a time and wait for "ok" before the next.

## 2. What is locked

Never change, swap, upgrade, or "improve" these.

- App: React Native with Expo. Android EAS development build (not Expo Go). FlashList, expo-secure-store, expo-notifications, TanStack Query (server state), Zustand (client state).
- Server: Node.js LTS, Express, TypeScript (strict mode), Zod.
- Database: PostgreSQL with pooled connections. Sharding simulation = two separate PostgreSQL databases, routed by a hash of `team_id`.
- Redis for cache, rate limits, and locks. BullMQ for jobs.
- Tests: Vitest. Load tests: k6. Error tracking: Sentry on app and server.
- Data model: use the tables and fields in PRD section 7. Do not rename or redesign them. The only approved addition is the `user_teams` lookup table.
- Plans, in cents. Never change these numbers:
  - Starter: 2000, up to 5 seats, no extra seats.
  - Team: 5000, up to 15 seats, extra seat 300.
  - Business: 12000, up to 40 seats, extra seat 200.
- Banned: Redux, Prisma, Hono, NestJS, Next.js API routes, other queue libraries, other test runners, AsyncStorage for tokens.
- Do not add any package that is not listed here. Ask first and say what it does.

Decided by the developer. These are locked too (details in `docs/decisions/0001-rota-open-decisions.md`):
- Payments: Flutterwave, test mode only, behind one adapter in `providers/payments`.
- Login: email and password, plus Google sign-in.
- Grace period: 5 days. Notify the owner on day 0, day 3, and day 5. Then restrict: Staff read-only, Owner sees the billing screen.
- Extra seats: Team maximum 25 seats, Business maximum 100. Store caps in plan config, not in code.
- Plan change on the last day: use `daysLeft = max(1, actualDaysLeft)`.
- Settings sync: refetch when the app opens or returns to the foreground. No real-time.
- Database tool: Drizzle ORM with the `pg` driver.
- Token lifetimes: access 15 minutes. Refresh 30 days, rotated on every use. Password reset 30 minutes, single-use. Invite 7 days, single-use.
- Global database (not split by team): `users`, `refresh_tokens`, `devices`, `settings`, `plans`, `invites`, `idempotency_keys`, and a lookup table `user_teams` (user_id, team_id).
- Sharded by hash of `team_id`: `teams`, `memberships`, `shifts`, `swap_requests`, `activity_events`, `subscriptions`, `ledger_entries`, `webhook_events`.

## 3. What must never happen

Breaking ANY rule below means the task FAILED, even if the code runs and the tests pass. IDs point to the PRD.

**Money and billing**
1. Store every amount as a whole number in the smallest unit (cents). Never use decimals or floats for money. Anywhere, ever. (BILL-1)
2. Write proration yourself, on the server. Never use a provider's proration. Use whole numbers, divide last, round down with floor, and treat periods as 30 days. (BILL-2, PRD 4.2)
   - Credit = floor(oldPrice × daysLeft ÷ 30)
   - Cost = floor(newPrice × daysLeft ÷ 30)
   - Upgrade charge = Cost − Credit
   - Seats added = floor(extraSeatPrice × seats × daysLeft ÷ 30)
   - Proof: Starter to Team with 20 days left must give 2000. Team plus 3 seats with 12 days left must give 360.
3. Upgrades and added seats apply now. Downgrades and removed seats apply at period end. Never refund part of a payment. (PRD 4.3)
4. Only a verified provider webhook can mark a payment as paid. The app and the checkout redirect never decide success. (BILL-3)
5. On every webhook: verify the signature first, reject a bad one, store the event ID (unique), skip a duplicate, queue a job, and return fast. Do the real work in the job. (BILL-4)
6. Every payment request carries an idempotency key. A repeated key returns the stored result. (BILL-5)
7. The ledger is append-only. Never UPDATE or DELETE a ledger row. Fix mistakes with new rows. Subscription state must be rebuildable from the ledger. (BILL-6)
8. Enforce seat limits on the server. Starter can never add seats. (BILL-7)
9. A failed renewal gets a grace period, owner notifications, then restricted access. (BILL-8)
10. Never cache subscriptions, payment status, credit balances, or webhook and idempotency records.

**Access and security**
11. Check permissions on the server for every endpoint, using the matrix in PRD 2.1. Hiding a button in the app protects nothing. (RBAC-1, RBAC-3)
12. Never trust a role sent by the client. Confirm the user's membership and role in the database on each request.
13. Every query on team data filters by `team_id`. A user in Team A must never read Team B data. (RBAC-2)
14. Validate every request body, query, and param with Zod before using it. Reject bad input with 400.
15. No secrets in the repo, the app, or the chat. Secrets live only in server environment variables. Never put a secret in an `EXPO_PUBLIC_` variable. Keep `.env.example` current with names only. Never commit `.env`.
16. Store tokens in the app with expo-secure-store only. Never AsyncStorage or localStorage. (AUTH-3)
17. Access tokens are short-lived. The refresh token rotates on every use. A reused refresh token gets 401 and revokes its whole token family. Log-out-all revokes every refresh token for the user. (AUTH-3, 4, 5)
18. Hash passwords with a strong, slow hash. Store only hashes of invite, reset, and refresh tokens. Invite and reset tokens are single-use and expire. (AUTH-1, 6, 7)
19. Rate limit with Redis, never an in-memory object. Cover login, password reset, invites, payment start, and expensive endpoints, per user and per IP. Return 429. (AUTH-8)

**Data and behavior**
20. The activity feed uses cursor pagination on (created_at, id). Never offset. (FEED-2)
21. Settings live on the server as the single source of truth. The server sets `updated_at`. The latest change wins. (SET-1, SET-3)
22. Send push notifications only from background jobs, never inside the request. Delete a token the push service reports as invalid. Respect each user's quiet hours, time zone, and notification type toggles on the server. (PUSH-2, 3, 5, 6)
23. Slow or unreliable work (push, webhooks, email, slow API calls) runs as a BullMQ job with exponential backoff and a failed list after a set number of attempts.
24. Log every request with request ID, user ID, route, response time, and result. Log every job attempt.
25. Out of scope: iOS builds, live payments, store publishing, payroll, time clocking, automatic shift generation.

## 4. How the work is arranged

```
rota/
  AGENTS.md
  .env.example            names only, no values
  docs/                   PRD.md, ARCHITECTURE.md, STATE.md, SECURITY.md,
                          SHARDING.md, LEARNING-LOG.md, decisions/
  load-tests/             k6 scripts and the written report
  app/src/                screens, components, features/<name>, api, store, lib
  server/src/
    config/               env loading (validated with Zod)
    middleware/           auth, request ID, rate limit, error handler
    db/                   connection pools, shard router, migrations
    modules/<name>/       routes, service, repository, schema, tests
    jobs/                 queues and workers
    providers/            payment adapter, push adapter
    lib/                  logger, small helpers
```

Layer rules:
- Routes only validate (Zod), check permission, and call a service. No SQL and no business rules in routes.
- Services hold the business rules. Repositories are the only place SQL runs. Every team query takes `team_id`.
- Only `providers/` knows the payment provider's data shape. Only `db/` decides which database a team uses.
- The webhook route only verifies, stores the event, queues a job, and returns. Workers do the rest.
- Proration is a pure function (no database, no network) so tests can cover it fully.
- A module never reads another module's repository. It calls that module's service.
- The app talks only to the Rota server. It never calls the payment provider with a secret key.
- Migrations are SQL files, one per change. Never edit a migration that has already run.

## 5. How the code should look

- TypeScript strict mode. No `any`. ES modules. async/await.
- Use Node.js LTS and current stable versions of Expo and libraries. No deprecated APIs.
- Small functions that do one job. Clear names. Comments explain WHY, not what.
- No dead code, no commented-out code, no `console.log` (use the logger). Extract repeated code.
- Consistent error codes: 400, 401, 403, 404, 409, 429.
- Use Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). One feature per branch. Commit or push ONLY when the developer asks.

## 6. What counts as done

A task is done only when ALL of these are true:
1. `npm run build` and the type check finish with zero errors. Lint and all tests pass.
2. Every PRD requirement ID in the task has evidence: test output or the database record, shown to the developer.
3. `.env` is not staged, and no secret appears in the diff.
4. Docs are updated. A decision record is added to `docs/decisions/` if a choice was made.

Finish every task with:
- A checklist of each PRD requirement ID, marked met or not met. Never say "done" while any item is not met. Say which one and why.
- A simple-English summary of what was built, how to approach building it from scratch, and a plain re-explanation of the task.
- A reminder for the developer to write their own paragraph in `LEARNING-LOG.md` without AI.

## 7. What to do when unsure

Stop and ask. Never guess.
- Never add a feature, endpoint, screen, or table that the PRD does not list. Never invent scope.
- Never start a later phase early, even "just a little."
- Never change a locked choice. Never weaken or skip a rule in section 3 to make something work.
- Never write a workaround, hack, or tangled code to get past a problem. Stop and explain the problem instead.
- Never disable a check, test, or type rule to make a build pass.
- For anything the PRD or this file does not settle, give at most 2 options with one recommendation and wait for the developer's answer. Then record it in `docs/decisions/`.
- If two rules conflict, or the PRD is unclear, stop and say exactly which lines conflict.
