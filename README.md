# Rota

A shift scheduling app for small teams, with seat-based billing.

[![CI](https://github.com/ShaDowCRYT/rota/actions/workflows/ci.yml/badge.svg)](https://github.com/ShaDowCRYT/rota/actions/workflows/ci.yml)

**Status:** In development. Phase 1 (auth and teams) is complete. The server side of Phases 2 and 3 is complete, and the app screens for shifts, activity, and swaps are now built.

Done so far: Express server with health checks, PostgreSQL and Redis connections, Sentry on the server, CI, an Expo app with design tokens, email and Google sign-in, refresh-token rotation and logout, teams with server-side roles and isolation, invites and password reset with deep links, a week schedule, shift create/edit/delete, an infinite activity feed, and swap request/cancel/approve/reject with an optimistic UI.

Next: Phase 4 (settings, push jobs, and offline shifts). Still to do: Sentry on the app, an Android development build, and the demo links.

## Demo

- GIF of the app (coming)
- Android build download (coming)
- Demo video (coming)
- Live backend URL (coming)

## Tech stack

Built so far:
- Node.js LTS, Express, TypeScript (strict mode), Zod
- PostgreSQL with pooled connections, using Drizzle ORM with the `pg` driver
- Redis (Docker for local development)
- Sentry (server), Vitest, ESLint (server), and GitHub Actions CI
- React Native with Expo (SDK 58) and TanStack Query, with a design-token theme

Planned:
- Zustand for app-only state (installed, not used yet)
- BullMQ for background jobs
- Flutterwave in test mode for payments
- k6 for load tests
- EAS development build for push notifications and Google sign-in

## How to run the server locally

1. Install Node.js (LTS) and Docker.
2. Copy `.env.example` to `.env`.
3. Start Redis with Docker: `docker compose up -d`.
4. Set `REDIS_URL=redis://127.0.0.1:6379` in `.env`.
5. Add a Neon `DATABASE_URL` to `.env`.
   Optional: set `DB_POOL_MAX` (defaults to 10).
6. From the repository root, run:

   ```bash
   cd server
   npm ci
   npm run dev
   ```

7. The server exposes `GET /health` and `GET /health/ready`.

## Payments (Flutterwave test mode)

Payments are server-only and use Flutterwave **test mode**. The app never holds secret keys and never decides that a payment succeeded.

### Configure test mode

1. In the server `.env`, set `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_SECRET_HASH`, `BILLING_CURRENCY`, `PUBLIC_API_URL` and `RUN_WORKER=true`. Names are listed in `.env.example`; never paste secret values into a file that gets committed.
2. In the Flutterwave test dashboard, set the webhook URL to `<PUBLIC_API_URL>/webhooks/flutterwave` and use the same webhook secret hash as `FLUTTERWAVE_SECRET_HASH`.
3. Start the server with `npm run dev`. The worker runs in the same process while `RUN_WORKER=true`. On start it re-enqueues unprocessed webhook events.
4. If a value is missing, payments return 503 and the webhook route is not mounted.

### Make a real test-mode payment

1. Sign in as an Owner and create a team. Copy the team UUID from the app or your database.
2. Send `POST /teams/<teamId>/billing/checkout` with an `Idempotency-Key` header (at least 8 printable characters) and body `{"planId":"starter","seats":5}`. Use a fresh key for a new attempt; repeating the same key returns the stored result.
3. The response contains `checkoutUrl`, `paymentId`, `amountCents`, and `currency`. For Starter, `amountCents` is `2000`. Open `checkoutUrl` and pay with a Flutterwave test card.
4. Flutterwave redirects to `<PUBLIC_API_URL>/billing/return`. That page only says payment is processing. It never marks the payment paid.
5. Flutterwave sends `POST /webhooks/flutterwave` with `verif-hash`. The server rejects a bad hash with 401, stores the event ID, queues a job, and returns 200.
6. The worker verifies the transaction, then checks `tx_ref`, integer cents, and currency. A mismatch marks the payment failed and writes no ledger rows. A provider error is retried by BullMQ with exponential backoff.
7. Poll `GET /teams/<teamId>/billing`. Show success only when `status` is `active` and `latestPaymentStatus` is `succeeded`.
8. To test idempotency, send the same webhook more than once. The duplicate response is `{ "status": "duplicate" }` and it adds no ledger rows once processed.

### Local proof runs

From the `server` folder, run `npx tsx scripts/billing-pipeline-check.ts --quick` for a small check or `npx tsx scripts/billing-pipeline-check.ts --full` for 50 simultaneous jobs over 5 rounds. The script prints `amount_mismatch_ledger_rows: 0` from a fresh proof team. Run `npx tsx scripts/lifecycle-check.ts --quick` to prove renewals, notices, restriction, and reconciliation with a fake provider. See [`docs/BILLING.md`](docs/BILLING.md) for the full pipeline and cleanup rules.

## Billing lifecycle

Subscriptions move from `active` to `past_due` when the 30-day period ends. The owner receives notices on day 0, day 3, and day 5. On day 5 the team becomes `restricted`: staff and managers keep read access, all shift/swap/invite/member writes return 402, and the owner can still open billing and pay. A verified renewal starts the next 30-day period.

A 15-minute BullMQ scheduler handles renewals. A startup job catches up when the Render service wakes. If a webhook is missed, the scheduler verifies stale renewal payments by `tx_ref` through the same apply function as the webhook worker, so a payment cannot be applied twice. See decision [`0030`](docs/decisions/0030-billing-lifecycle-and-reconciliation.md) for the choices and Redis command estimate.

## How to run the app locally

You need the server running first (see "How to run the server locally" above) and an Android phone with Expo Go, on the **same Wi-Fi** as your computer.

1. From the `app` folder, run:

   ```bash
   npm ci
   npx expo start -c
   ```

2. Scan the QR code with Expo Go. The app reads the Metro server address from Expo and uses that computer's host with port 3000. You do not need to put an IP address in `app/.env`.
3. For an Android development build that includes native Google sign-in, run `npx expo start --dev-client -c` instead of `npx expo start -c`, then open the app from that build.

**When to set `EXPO_PUBLIC_API_URL`:** only to override the automatic address, for example if the phone is on a hotspot (so it cannot see your computer) or your backend is deployed somewhere else. Create `app/.env` with:

```
EXPO_PUBLIC_API_URL=http://YOUR-IP:3000
```

Do not use `localhost` or `127.0.0.1`. On your phone, `localhost` means the phone itself, not your computer, so the app would never reach the server. A production build has no automatic address, so it must set `EXPO_PUBLIC_API_URL`.

**After you change `app/.env`**, stop Expo and start it again with `npx expo start -c`. Expo reads environment variables only when it starts, and `-c` clears its cache, so an old value would otherwise stay in use.

### Troubleshooting

- **"Can't reach the server" in the app**: allow Node.js through Windows Firewall on private networks, and check that both devices are on the same Wi-Fi. Check the server from the phone by opening `http://YOUR-IP:3000/health`; you should see `{"status":"ok"}`.
- **The phone is on a hotspot**: set `EXPO_PUBLIC_API_URL` to an address the phone can actually reach.
- **"Unable to resolve host"**: the address in `app/.env` is still a placeholder or has a typo.
- **Expo Go says the SDK doesn't match**: update Expo Go from the Play Store.

### Public environment variables

Anything starting with `EXPO_PUBLIC_` is bundled into the app and can be read by anyone who has it. Never put a secret in one.

| Variable | Why it is safe to expose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Optional override for the server address. It is not a secret, and the server checks every request anyway. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | It identifies Rota's Google OAuth client. It is a public client ID, not a password or private key. |

## App environment variables

| Name | Why it is safe |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Optional override for the server address; required in production. It is not a password, token, or secret key, so it is safe to include in the app bundle. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | It is a public OAuth client ID used by the app to ask Google for an ID token. It is not a secret. |

## Android development build and Google sign-in

Google sign-in uses native code, so it does not run in Expo Go. Build and install an Android development build once, then start Metro with:

```bash
npx expo start --dev-client -c
```

Open the app from that development build. If `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is missing, the "Continue with Google" button is hidden and email login still works.

For Google Cloud, add your Google account as a **test user** on the OAuth consent screen. Use the Web client ID as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; the Android OAuth client must match the package `com.shadowcryt.rota` and the SHA-1 of the build you are testing. A mismatched SHA-1 usually shows as a Google error or a silent cancellation.

The app sends the Google ID token only to `POST /auth/google` on the Rota server. It is never written to SecureStore, logged, or shown on screen. Rota stores only its own access token in memory and its refresh token in SecureStore.

## Testing invite and password reset deep links

Rota uses the `rota://` scheme. Invite links look like `rota://invite?token=...` and reset links look like `rota://reset?token=...`.

### Join with an invite link

1. Open Rota and sign in.
2. On Home, tap "Join a team with an invite link" (it also appears when you are not in a team yet).
3. Paste the whole invite link you were sent, or just the token, then tap "Continue".
4. Review the invite and tap "Join this team".

### Open a link with adb

To open a link from a terminal with the phone connected by USB:

```bash
adb shell am start -a android.intent.action.VIEW -d "rota://invite?token=REPLACE_WITH_INVITE_TOKEN"
adb shell am start -a android.intent.action.VIEW -d "rota://reset?token=REPLACE_WITH_RESET_TOKEN"
```

Replace the placeholders with a real token. Never commit a real token. The invite link is shown once on the invite screen right after you create it. On a development server, the reset link is written to the server log by the development email sender. The app keeps deep-link tokens in memory only: if you close the app before signing in, open the link again.

### Production note

A real release would use HTTPS App Links (a website plus an `assetlinks.json` file) so invite links open the app when tapped from chat or notes apps. The current `rota://` scheme works in development and with adb, but many apps do not make custom-scheme links tappable.

## Manual test: Phase 2/3 app screens

Use the Android development build (`npx expo start --dev-client -c`) with the local server running. Sign in as an Owner for steps 1-7, then sign in as a Staff member for steps 8-9.

1. Open a team. Confirm four tabs: Schedule, Members, Activity, Swaps.
2. In Members, change a member to manager and back to staff, then remove a member and cancel the confirmation once before confirming. Confirm a missing team redirects home.
3. Create an invite, copy or share the link (it is shown once), confirm it appears in Pending invites, then revoke it after the confirmation.
4. In Schedule, use Previous/Next week, then Create shift. Pick a teammate, a day chip, 15-minute start/end chips, and save. Confirm end-before-start shows "End time must be after start time." Create an overlapping shift and confirm "That shift overlaps another shift for that person".
5. Open a shift. Confirm assignee email and local start/end time. As Owner/Manager you see Edit shift and Delete shift; use Delete once with its confirmation.
6. Edit a shift, change the time or assignee, and save. Confirm the Schedule row updates.
7. To seed the feed for your test team, run this from the `server` folder (replace `<id>` with the team UUID):

   ```bash
   npx tsx scripts/seed-activity.ts --team <id>
   ```

   Then open Activity, scroll to the bottom twice, pull to refresh, and confirm sentences use member emails and the list ends with "You are all caught up".
8. As Staff, open one of your future shifts, tap Request swap, choose a teammate or "Open to the team", and send. The badge should say "Swap requested" immediately and the button should disable. Stop the server before sending on a second shift to confirm the label rolls back with a friendly message.
9. In Swaps, cancel a pending request as Staff. Sign in as Owner/Manager and approve or reject a pending request; for an open request, choose the new assignee first. Confirm 409 messages read "This request was already decided" and "A swap is already requested for this shift".

## Production note: app store billing rules

To be written before release

## Deploying to Render

Smoke test after deploy (no secrets, GET-only):

```bash
node scripts/smoke.mjs https://YOUR-SERVICE.onrender.com
```

### Render dashboard steps (manual)

1. In Render, create a **Blueprint** and connect the `ShaDowCRYT/rota` repo; Render reads `render.yaml` from the repo root.
2. Confirm service: `rota-api`, Node, Frankfurt, Free, `rootDir server`, build `npm ci --include=dev && npm run build`, start `npm start`, health `/health`.
3. Fill secret env vars marked `sync: false`: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `GOOGLE_WEB_CLIENT_ID` (optional), `SENTRY_DSN` (optional). Keep `NODE_ENV=production` and `TRUST_PROXY_HOPS=2` as in the blueprint.
4. Deploy. After first deploy, run `node scripts/smoke.mjs https://<your-service>.onrender.com`.
5. Safe post-deploy IP check: verify rate-limit/429 behavior from your real client and confirm logs show the expected client IP; do not add a debug IP endpoint. `TRUST_PROXY_HOPS=2` is used for Render's public proxy path; if you observe proxy-internal or unexpected client IPs in logs, stop and recheck hop count before changing.

### Free-plan and shared-dev notes

- Free web service sleeps after ~15 min idle; first request may cold-start 30-60s. `0.1 CPU` makes login/signup CPU work slower.
- Background workers run in the same web process until the next billing/jobs slice moves them out.
- Dev and prod currently share the same Neon database (acceptable for this learning phase); be careful with test data/migrations.

### Password reset links

On a development server, reset links are written to the server log by the development email sender. They are not emailed in dev.

## Architecture

See the recorded decisions in [`docs/decisions/`](docs/decisions/).

## Key decisions

See [`docs/decisions/`](docs/decisions/).
