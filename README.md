# Rota

A shift scheduling app for small teams, with seat-based billing.

[![CI](https://github.com/ShaDowCRYT/rota/actions/workflows/ci.yml/badge.svg)](https://github.com/ShaDowCRYT/rota/actions/workflows/ci.yml)

**Status:** In development. Phase 1 (auth and teams) is complete. Phase 2 (shifts and feed) is next.

Done so far: Express server with health checks, PostgreSQL and Redis connections, Sentry on the server, CI, an Expo app with design tokens and live server status, email and Google sign-in, refresh-token rotation and logout, teams with server-side roles and isolation, invites and password reset with deep links, and automated tests with no `.env` needed.
Next: Phase 2 (shifts and feed). Still to do: Sentry on the app, shifts, the activity feed, and the demo links.

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

To open a link from a terminal with the phone connected by USB:

```bash
adb shell am start -a android.intent.action.VIEW -d "rota://invite?token=REPLACE_WITH_INVITE_TOKEN"
adb shell am start -a android.intent.action.VIEW -d "rota://reset?token=REPLACE_WITH_RESET_TOKEN"
```

Replace the placeholders with a real token. Never commit a real token. The invite link is shown once on the invite screen right after you create it. On a development server, the reset link is written to the server log by the development email sender. The app keeps deep-link tokens in memory only: if you close the app before signing in, open the link again.

## Production note: app store billing rules

To be written before release

## Architecture

See the recorded decisions in [`docs/decisions/`](docs/decisions/).

## Key decisions

See [`docs/decisions/`](docs/decisions/).
