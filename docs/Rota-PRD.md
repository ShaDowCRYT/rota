# Rota: Product Requirements Document

Mobile Task A, Final Graduation Task. Product Design and Engineering Bootcamp, Dev and Design HQ

| **Field** | **Value**                                                                          |
|-----------|------------------------------------------------------------------------------------|
| Product   | Rota, a shift scheduling app for small teams (restaurants, clinics, retail stores) |
| Owner     | ShaDowCRYT                                                                         |
| Status    | Draft v1.0, ready for build planning                                               |
| Source    | Final Graduation Task, Part 2, sections 2.1 to 2.3 and 2.5                         |
| Platform  | React Native (Expo) Android development build, Node.js backend, PostgreSQL, Redis  |

# 1. Overview

## 1.1 Product summary

A business owner creates a team, invites staff, and publishes shifts. Staff see their shifts, request swaps, and get notified about changes. Managers approve swaps. The business pays a monthly subscription priced per staff member (per seat).

## 1.2 Problem

Small teams schedule shifts through group chats and spreadsheets. Changes get missed, swaps happen without approval, and staff get messages at 2am. Rota gives each team one trusted source for who works when, and it enforces rules on the server.

## 1.3 Goals

- Ship a working app where auth, money, notifications, and data stay correct under real use.

- Prove the backend system design standard: pooling, read/write routing, sharding simulation, caching, rate limiting, queues, idempotency, observability, load testing.

- Produce evidence an employer can check: tests, load report, docs, demo video, and a LinkedIn post.

- Give the owner material for job hunting (Rota matches scheduling, workforce, HR, and B2B SaaS companies).

## 1.4 Success metrics

| **Metric**                                      | **Target**                                                            |
|-------------------------------------------------|-----------------------------------------------------------------------|
| Staff user calls delete-shift endpoint directly | Rejected with 403. Automated test passes.                             |
| Team A reads Team B data                        | Never possible. Automated test passes.                                |
| Proration unit tests                            | At least 8 cases pass, with integer cent results.                     |
| Duplicate payment webhook                       | Processed once. Second delivery ignored.                              |
| Activity feed at 10,000+ records                | Cursor pagination with index. EXPLAIN ANALYZE shown before and after. |
| Load test: 200 virtual users on activity feed   | Response times reported before and after caching.                     |
| Secrets in app bundle                           | None. Every EXPO_PUBLIC\_ variable listed and justified.              |

## 1.5 Non-goals

- Publishing to Google Play or the App Store. A development build is enough.

- iOS builds. Android is enough for this task.

- Live payments. Payments run in provider test mode (Paystack or Flutterwave; Stripe if available).

- Payroll, time clocking, or shift auto-generation.

- Refunding partial payments on downgrade. Downgrades apply at period end.

Production note (required in README): Apple and Google require their own in-app purchase systems for many digital subscriptions sold inside apps. Rota sells a B2B SaaS subscription, so the README must explain how those rules would affect Rota in production (for example, selling the subscription on the web and letting the app only sign in).

# 2. Users and Roles

| **Role** | **Who**        | **Can do**                                                                        |
|----------|----------------|-----------------------------------------------------------------------------------|
| Owner    | Business owner | Creates the team, manages billing, invites and removes members, has full control. |
| Manager  | Shift lead     | Creates and edits shifts, approves or rejects swaps.                              |
| Staff    | Employee       | Views shifts, requests swaps, sets own preferences.                               |

## 2.1 Permission matrix (enforced on the server)

| **Action**                                 | **Owner** | **Manager** | **Staff** |
|--------------------------------------------|-----------|-------------|-----------|
| Create team, manage billing and plan       | Yes       | No          | No        |
| Invite and remove members, change roles    | Yes       | No          | No        |
| Create, edit, delete shifts                | Yes       | Yes         | No        |
| Approve or reject swaps                    | Yes       | Yes         | No        |
| View team shift calendar and activity feed | Yes       | Yes         | Yes       |
| Request a swap on own shift                | Yes       | Yes         | Yes       |
| Edit own settings and devices              | Yes       | Yes         | Yes       |
| Log out of all devices (own account)       | Yes       | Yes         | Yes       |

**Assumption:** only the Owner invites, matching the brief. Allowing Managers to invite is a small change to this matrix.

# 3. Functional Requirements

Each requirement has an ID for traceability. "Check" says how you prove it works. Per Rule 4, success means the correct record exists in the database and you can show it.

## F1. Authentication, invites, and sessions

| **ID** | **Requirement**                                                                                                 | **Check**                                                                      |
|--------|-----------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------|
| AUTH-1 | Email and password sign-up, login, logout.                                                                      | Row in users table. Password stored as a strong hash.                          |
| AUTH-2 | One extra method: Google sign-in or magic link.                                                                 | Login works end to end on the dev build.                                       |
| AUTH-3 | Short-lived access token plus refresh token. Tokens stored in expo-secure-store, never AsyncStorage.            | Code review. No token in AsyncStorage.                                         |
| AUTH-4 | Rotate the refresh token on every use. Reject a refresh token that was already used.                            | Test: reuse an old refresh token and get 401, and the token family is revoked. |
| AUTH-5 | Log out of all devices (revokes every refresh token for the user).                                              | Test: second device fails to refresh after the action.                         |
| AUTH-6 | Invite by email or link. The link opens the app (deep link) and lands the user in the right team after sign-up. | Demo: invited user ends in the correct team with the correct role.             |
| AUTH-7 | Password reset with a single-use, expiring token.                                                               | Test: second use fails. Expired token fails.                                   |
| AUTH-8 | Rate limit login, password reset, and invites with Redis.                                                       | Test: the Nth request returns 429.                                             |

## F2. Role-based permissions and team isolation

| **ID** | **Requirement**                                                                    | **Check**                                                           |
|--------|------------------------------------------------------------------------------------|---------------------------------------------------------------------|
| RBAC-1 | Every endpoint checks role on the server using the matrix in section 2.1.          | Test: Staff calls DELETE shift directly and gets 403.               |
| RBAC-2 | Every query filters by team ID (or PostgreSQL row-level security is used).         | Test: user in Team A requests Team B resources and gets 404 or 403. |
| RBAC-3 | The app hides actions the role cannot do, but never relies on that for protection. | Same tests as above, run without the app.                           |

## F3. Shift calendar and activity feed

| **ID** | **Requirement**                                                                              | **Check**                                   |
|--------|----------------------------------------------------------------------------------------------|---------------------------------------------|
| CAL-1  | Calendar view of team shifts. Managers and Owners create, edit, delete shifts.               | Row in shifts table after create.           |
| FEED-1 | Activity feed lists new shifts, swaps, and changes.                                          | Feed shows each event once.                 |
| FEED-2 | Cursor pagination on the server using (timestamp, id) so equal timestamps are never skipped. | Test with many rows sharing one timestamp.  |
| FEED-3 | Database index supports the cursor query. Show EXPLAIN ANALYZE before and after.             | Both plans saved in docs.                   |
| FEED-4 | Infinite scroll with FlashList (or FlatList with a written reason) plus pull to refresh.     | Demo.                                       |
| FEED-5 | Loading, empty, end-of-list, and error states. Prevent duplicate requests on fast scroll.    | Demo and a test for request de-duplication. |
| FEED-6 | Seed at least 10,000 activity records.                                                       | Count query result saved.                   |

## F4. Shift swaps

| **ID** | **Requirement**                                                                                                                   | **Check**                                          |
|--------|-----------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------|
| SWAP-1 | A member requests a swap on their own shift (target person or open to the team).                                                  | Row in swap_requests with status pending.          |
| SWAP-2 | Manager or Owner approves or rejects. Approval changes the shift assignee in one transaction.                                     | Test: the shift assignee changes only on approval. |
| SWAP-3 | Server rejects swaps that create conflicts (overlapping shifts for the same person).                                              | Test.                                              |
| SWAP-4 | Optimistic update in the app: label shows "Swap requested" at once, button disables, rolls back with an error message on failure. | Demo with the server forced to fail.               |
| SWAP-5 | Swap events create feed items and push notifications.                                                                             | Feed row and notification job exist.               |

## F5. Subscription and billing

Full detail is in section 4. Summary requirements:

| **ID** | **Requirement**                                                                                         | **Check**                                            |
|--------|---------------------------------------------------------------------------------------------------------|------------------------------------------------------|
| BILL-1 | Three plans with exact prices stored in cents.                                                          | Plans seeded with integer cents.                     |
| BILL-2 | Upgrade, downgrade, add seats, remove seats, with server-side proration.                                | At least 8 unit tests.                               |
| BILL-3 | Payment through provider checkout in test mode. The app never decides success. A verified webhook does. | Payment shown as paid only after webhook processing. |
| BILL-4 | Verify webhook signature, process in a background job, store each event ID, ignore duplicates.          | Test: send the same event 3 times, one ledger row.   |
| BILL-5 | Idempotency key on every payment request.                                                               | Test: repeat key returns stored result.              |
| BILL-6 | Append-only ledger. Subscription state can be rebuilt from it.                                          | Rebuild script matches live state.                   |
| BILL-7 | Seat limits enforced on the server.                                                                     | Test: Starter owner cannot invite a sixth person.    |
| BILL-8 | Failed renewal: grace period, owner notifications, then restricted access.                              | Test with a simulated failed renewal.                |

## F6. Push notifications

| **ID** | **Requirement**                                                                                                     | **Check**                            |
|--------|---------------------------------------------------------------------------------------------------------------------|--------------------------------------|
| PUSH-1 | Register each device push token after login. Store it linked to user and device. One user can have several devices. | Rows in devices table.               |
| PUSH-2 | Send notifications from a background job, never in the triggering request.                                          | Request returns before the job runs. |
| PUSH-3 | When the push service reports an invalid token, delete it.                                                          | Test with a fake invalid receipt.    |
| PUSH-4 | Tapping a notification opens the exact screen (deep link).                                                          | Demo.                                |
| PUSH-5 | Notification types are grouped (shift changes, swaps, billing). Users toggle each type.                             | Muted type sends nothing.            |
| PUSH-6 | Server respects quiet hours and the user's time zone. Non-urgent notifications are delayed until quiet hours end.   | Test at a simulated 2am local time.  |

## F7. Settings coordination

| **ID** | **Requirement**                                                                                                                                                                                                                       | **Check**                      |
|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------|
| SET-1  | Store on the server: quiet hours, time zone, notification types, language, theme. The server is the single source of truth.                                                                                                           | Settings row per user.         |
| SET-2  | Changes on one device appear on other devices after refetch on app open or foreground (or real-time updates).                                                                                                                         | Demo with two devices.         |
| SET-3  | Each setting carries a server-set updatedAt. Latest change wins. Document this and its weakness (an offline device with an old change can lose, or overwrite on reconnect depending on order; clock trust sits with the server only). | Documented in ARCHITECTURE.md. |
| SET-4  | Optimistic updates with rollback for settings changes.                                                                                                                                                                                | Demo with failed request.      |
| SET-5  | The notification job reads settings before sending.                                                                                                                                                                                   | Same test as PUSH-6.           |

## F8. Offline viewing and client state

| **ID**  | **Requirement**                                                                                 | **Check**                    |
|---------|-------------------------------------------------------------------------------------------------|------------------------------|
| OFF-1   | Persist the user's upcoming shifts so they display offline, with a visible "last updated" time. | Demo in airplane mode.       |
| STATE-1 | TanStack Query for all server data, with cache times explained.                                 | STATE.md.                    |
| STATE-2 | One client-state tool (Zustand or React state) with a written reason.                           | STATE.md.                    |
| STATE-3 | STATE.md maps every important piece of data to where it lives and why.                          | File exists and is complete. |

# 4. Billing Detail

## 4.1 Plans (stored in cents)

| **Plan** | **Price**                     | **Seats included** | **Extra seat**            |
|----------|-------------------------------|--------------------|---------------------------|
| Starter  | 2000 cents (\$20) per month   | Up to 5            | Not available             |
| Team     | 5000 cents (\$50) per month   | Up to 15           | 300 cents (\$3) per month |
| Business | 12000 cents (\$120) per month | Up to 40           | 200 cents (\$2) per month |

## 4.2 Proration formula and rounding rule

All maths uses whole numbers (cents and days). Divide last, round down (floor), as in the brief.

- **Credit** = floor(oldMonthlyPrice × daysLeft ÷ periodDays)

- **Cost** = floor(newMonthlyPrice × daysLeft ÷ periodDays)

- **Charge today** = Cost − Credit (upgrade only)

- **Seat add** = floor(extraSeatPrice × seatsAdded × daysLeft ÷ periodDays)

Worked example from the brief: Starter to Team with 20 of 30 days left. Credit = floor(2000 × 20 ÷ 30) = 1333. Cost = floor(5000 × 20 ÷ 30) = 3333. Charge = 2000 cents (\$20.00).

Interview example: Team customer adds 3 extra seats with 12 of 30 days left. Charge = floor(300 × 3 × 12 ÷ 30) = 360 cents (\$3.60).

## 4.3 Billing rules

- Upgrades and seat additions take effect now and charge the prorated amount.

- Downgrades and seat removals apply at the end of the period. No partial refunds.

- Next renewal charges the full price of the plan plus extra seats.

- Two changes in one period: calculate each change from the state at that moment. Each produces its own ledger rows.

- Change on day one of a period uses a full period. Change on the last day uses a minimum of one day or zero by a stated rule. Document the rule you pick and test it.

- Seat limits: the server blocks invites and role changes that would exceed the plan's seat allowance. Starter has no extra seats.

- Failed renewal: grace period of N days (set it, for example 5), notify the owner at each step, then restrict access (read-only for staff, billing screen for owner).

## 4.4 Required proration test cases (minimum 8)

| **\#**     | **Case**                            | **What it proves**                      |
|------------|-------------------------------------|-----------------------------------------|
| 1          | Upgrade Starter to Team mid-period  | Credit and cost rounding                |
| 2          | Upgrade Team to Business mid-period | Larger price gap                        |
| 3          | Downgrade Team to Starter           | Scheduled for period end, no charge now |
| 4          | Add seats to Team                   | Seat add formula                        |
| 5          | Remove seats from Team              | Applies at period end                   |
| 6          | Change on day one                   | Full-period maths                       |
| 7          | Change on last day                  | Edge rule for minimum days              |
| 8          | Two changes in one period           | Each change calculated separately       |
| 9 (extra)  | Add seats to Starter                | Rejected, not available                 |
| 10 (extra) | Seat count over plan cap            | Rejected by server                      |

## 4.5 Payment flow

- App asks the server to start checkout with an idempotency key header.

- Server creates a provider checkout (test mode) and returns the checkout URL or reference.

- User pays at the provider. The app does not decide success.

- Provider sends a webhook. Server verifies the signature, stores the event ID, and queues a job.

- Job writes ledger rows and updates subscription state in one transaction, then queues a notification.

- App refetches subscription state from the server.

Never cache: active subscriptions, payment status, credit balances, or webhook idempotency records.

# 5. Backend System Design Standard

| **Area**            | **Requirement for Rota**                                                                                                                                                                                                                                                       |
|---------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Connection pooling  | Use the provider's pooled string, PgBouncer, or ORM pool settings. Set a pool size and justify the number.                                                                                                                                                                     |
| Replication         | Route reads to a read connection and writes to the primary. Read-your-own-writes: for a short window (for example 5 seconds) after a user writes, that user reads from the primary. If no real replica exists, use a second connection string and document production changes. |
| Sharding simulation | Create two separate PostgreSQL databases. Route each team's data by a hash of team_id. Write SHARDING.md: shard key, how a very large team is handled, which queries became harder.                                                                                            |
| Caching             | Cache-aside in Redis for team rosters and shift calendars. TTL on every item. Invalidate when shifts change. Document what is cached and never cached.                                                                                                                         |
| Rate limiting       | Redis-based, per user and per IP. Strict on login, password reset, invites, payment initiation, and expensive endpoints.                                                                                                                                                       |
| Background jobs     | BullMQ on Redis for push, webhooks, emails, and slow calls. Exponential backoff retries and a failed list after a set number of attempts.                                                                                                                                      |
| Idempotency         | Idempotency key per payment attempt. Stored result returned on repeat. Webhook event IDs stored and duplicates skipped.                                                                                                                                                        |
| Observability       | Log every request with request ID, user ID, route, response time, result. Log every job attempt. Sentry on app and server. Be able to answer "what happened to this user's payment at 3:14pm?".                                                                                |
| Load testing        | k6 in a load-tests/ folder. 200 virtual users load the activity feed at once. Report response times before and after caching.                                                                                                                                                  |
| Security            | Zod on every request body. No secrets in repo or app. .env.example lists variable names only. SECURITY.md lists 8 threats and mitigations.                                                                                                                                     |

## 5.1 Eight threats for SECURITY.md (starting list)

- Stolen access token (short lifetime, secure storage).

- Stolen or replayed refresh token (rotation and reuse detection).

- Staff calling manager endpoints directly (server-side role checks).

- Cross-team data access (team ID filter or row-level security).

- Secrets extracted from the app bundle (secrets only on server).

- Brute force on login and reset (Redis rate limits).

- Forged or replayed payment webhooks (signature check and event ID store).

- Double payment from retries (idempotency keys).

# 6. Technical Stack

| **Layer**            | **Choice**                                                                                                                               |
|----------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| Mobile               | React Native with Expo, built in Antigravity. EAS Build development build for Android. FlashList. expo-secure-store. expo-notifications. |
| Client state         | TanStack Query (server state), Zustand or React state (client state), persisted cache for offline shifts.                                |
| Backend              | Node.js with Express or Hono (or Next.js API routes). Zod validation.                                                                    |
| Database             | PostgreSQL with pooled connections. Two databases for the sharding simulation.                                                           |
| Cache, limits, queue | Redis (Upstash free tier is fine). BullMQ.                                                                                               |
| Payments             | Paystack or Flutterwave in test mode (Stripe if available).                                                                              |
| Tooling              | Sentry, k6, Jest or Vitest, GitHub Actions optional.                                                                                     |

# 7. Data Model (High Level)

| **Entity**       | **Key fields**                                                                      | **Notes**                                              |
|------------------|-------------------------------------------------------------------------------------|--------------------------------------------------------|
| users            | id, email, password_hash, created_at                                                | Email unique.                                          |
| teams            | id, name, owner_id, plan_id, seat_count                                             | Shard key is team_id.                                  |
| memberships      | team_id, user_id, role                                                              | Unique (team_id, user_id).                             |
| invites          | id, team_id, email, role, token_hash, expires_at, used_at                           | Single-use token, store the hash.                      |
| shifts           | id, team_id, assignee_id, starts_at, ends_at, created_by                            | Index (team_id, starts_at).                            |
| swap_requests    | id, team_id, shift_id, requester_id, target_id, status, decided_by                  | Status: pending, approved, rejected, cancelled.        |
| activity_events  | id, team_id, type, actor_id, payload, created_at                                    | Index (team_id, created_at DESC, id DESC) for cursors. |
| refresh_tokens   | id, user_id, family_id, token_hash, used_at, revoked_at                             | Supports rotation and reuse detection.                 |
| devices          | id, user_id, push_token, platform, last_seen_at                                     | Many per user.                                         |
| settings         | user_id, quiet_start, quiet_end, timezone, notif_types, language, theme, updated_at | Server sets updated_at.                                |
| plans            | id, name, price_cents, seats_included, extra_seat_cents                             | Seeded.                                                |
| subscriptions    | team_id, plan_id, seats, period_start, period_end, status                           | Rebuildable from ledger.                               |
| ledger_entries   | id, team_id, type, amount_cents, ref, created_at                                    | Append-only. Never edit or delete.                     |
| webhook_events   | event_id, provider, received_at, processed_at                                       | Unique event_id.                                       |
| idempotency_keys | key, user_id, request_hash, response, created_at                                    | Unique per user and key.                               |

# 8. API Surface (High Level)

| **Area**             | **Endpoints**                                                                                                  |
|----------------------|----------------------------------------------------------------------------------------------------------------|
| Auth                 | POST /auth/signup, /auth/login, /auth/refresh, /auth/logout, /auth/logout-all, /auth/forgot, /auth/reset       |
| Teams and invites    | POST /teams, GET /teams/:id, POST /teams/:id/invites, POST /invites/accept, DELETE /teams/:id/members/:userId  |
| Shifts               | GET /teams/:id/shifts, POST /teams/:id/shifts, PATCH and DELETE /shifts/:id                                    |
| Feed                 | GET /teams/:id/activity?cursor=&limit=                                                                         |
| Swaps                | POST /shifts/:id/swap-requests, POST /swap-requests/:id/approve, /reject, /cancel                              |
| Billing              | GET /billing, POST /billing/checkout, POST /billing/change-plan, POST /billing/seats, POST /webhooks/:provider |
| Devices and settings | POST /devices, DELETE /devices/:id, GET and PATCH /me/settings                                                 |

Every endpoint validates input with Zod, checks role and team on the server, and returns consistent error codes (400, 401, 403, 404, 409, 429).

# 9. Testing and Evidence

- Permission test: Staff calls delete-shift directly and is rejected.

- Team isolation test: one team cannot read another team's data.

- Proration unit tests: at least 8 cases.

- Auth tests: refresh rotation, reuse rejection, logout-all, single-use reset token.

- Webhook tests: bad signature rejected, duplicate event ignored.

- Seat limit test: Starter owner cannot invite a sixth person.

- Pagination test: equal timestamps do not skip or repeat items.

- Load test: 200 virtual users on the activity feed, before and after caching.

- Evidence rule: for each test, save the output and show the database record.

# 10. Deliverables

| **Deliverable**                                      | **Done when**                                                                                               |
|------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| Public GitHub repo (or app and backend repos linked) | Clear folders: /app, /server, /docs, /load-tests. Conventional Commits. PRs per feature.                    |
| Android development build link                       | Installs and runs, push works.                                                                              |
| Deployed backend                                     | Public URL, env vars set on server only.                                                                    |
| Docs                                                 | README, ARCHITECTURE.md, STATE.md, SECURITY.md, SHARDING.md, LEARNING-LOG.md, plus ADRs in docs/decisions/. |
| Architecture diagram                                 | Shows app, API, Postgres shards, Redis, queue, workers, push service, payment provider.                     |
| Test results                                         | Permissions, team isolation, proration.                                                                     |
| Load test report                                     | Scripts and written results.                                                                                |
| 3-minute demo video                                  | Product first, then one technical deep dive.                                                                |
| LinkedIn post                                        | One specific decision. No announcement-style post.                                                          |
| Part 2 extras                                        | Case study on portfolio, 30 target companies added to tracker, CV and LinkedIn bullet with specifics.       |

README top section must show: one-line description, a GIF of the app, the download link, and the demo video link. Also include the app store billing note from section 1.5 and an EXPO_PUBLIC\_ variable list with reasons each is safe.

# 11. Suggested Build Phases

| **Phase**             | **Scope**                                                              | **Exit check**                                   |
|-----------------------|------------------------------------------------------------------------|--------------------------------------------------|
| 0\. Foundations       | Repo, Expo app, backend, Postgres, Redis, env setup, CI basics, Sentry | Health check endpoint and app talk to each other |
| 1\. Auth and teams    | F1, F2, invites, deep links                                            | Auth and isolation tests pass                    |
| 2\. Shifts and feed   | F3, seed 10,000 records, index, EXPLAIN ANALYZE                        | Cursor tests pass                                |
| 3\. Swaps and state   | F4, F8, optimistic updates, offline                                    | Demo in airplane mode                            |
| 4\. Settings and push | F7, F6, dev build, queue, quiet hours                                  | Quiet hours test passes                          |
| 5\. Billing           | F5, ledger, webhooks, proration tests                                  | All billing tests pass                           |
| 6\. Backend standard  | Pooling, routing, sharding simulation, caching, rate limits, k6        | Load report written                              |
| 7\. Docs and release  | Docs, diagram, demo video, post, case study                            | Every deliverable has a link                     |

Throughout: write a LEARNING-LOG.md entry after each AI-assisted feature (explain-back rule), and post on LinkedIn at least twice a week during the build.

# 12. Risks, Assumptions, and Open Questions

## 12.1 Risks

| **Risk**                                    | **Mitigation**                                                            |
|---------------------------------------------|---------------------------------------------------------------------------|
| Push notifications fail in Expo Go          | Use an EAS development build from the start.                              |
| Scope is large for one builder              | Follow the phases. Finish each phase's tests before moving on.            |
| Provider checkout setup delays billing      | Start the provider account early and use test keys.                       |
| Sharding adds query complexity              | Keep cross-team queries out of scope. Document what got harder.           |
| Cannot explain AI-written code in interview | Explain-back paragraph for every feature. Mock interview from section 13. |

## 12.2 Assumptions

- Only the Owner invites and removes members.

- Floor rounding on every proration calculation, as in the brief's worked example.

- Billing periods are 30 days in the formula, as in the brief's examples. Real calendar periods would use actual days.

- Extra seats are seats beyond a plan's included seats, priced per seat per month.

## 12.3 Open questions to settle before building

- Is there a maximum total seat count for Team and Business when extra seats are added? The brief lists included seats but no cap. Decide a cap and store it in plan config.

- Which provider: Paystack, Flutterwave, or Stripe? This sets webhook signature details.

- Google sign-in or magic link as the second auth method?

- How many days of grace period on failed renewal?

- Polling on app foreground, or real-time updates, for settings sync?

- What rule applies to a plan change on the last day (zero days left)?

# 13. Interview Preparation Map

| **Question**                                                             | **Where the answer lives**                     |
|--------------------------------------------------------------------------|------------------------------------------------|
| Why cursor pagination instead of offset?                                 | FEED-2, FEED-3, pagination test                |
| Staff calls delete-shift with Postman. What stops them?                  | RBAC-1, permission test                        |
| Access token is stolen. What can the attacker do and for how long?       | AUTH-3, AUTH-4, token lifetime in SECURITY.md  |
| Team customer adds 3 seats with 12 days left in a 30-day period. Charge? | Section 4.2: 360 cents                         |
| Provider sends the same webhook three times. What happens?               | BILL-4, webhook_events table                   |
| Quiet hours changed offline on phone, then on tablet. Which wins?        | SET-3, updatedAt rule and its weakness         |
| Why team_id as shard key? When does it fail?                             | SHARDING.md, hot shard for one very large team |
| Why send push from a job instead of the request?                         | PUSH-2, queue retries and request latency      |

*End of document.*
