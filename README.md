# Rota

A shift scheduling app for small teams, with seat-based billing.

[![CI](https://github.com/ShaDowCRYT/rota/actions/workflows/ci.yml/badge.svg)](https://github.com/ShaDowCRYT/rota/actions/workflows/ci.yml)

**Status:** In development. Phase 0 (foundations) is complete.

Done so far: Express server with health checks, PostgreSQL connection pool, Redis connection, optional Sentry error tracking on the server, automated tests, CI, an Expo app shell with design tokens that shows live server status, and app lint checks in CI.
Next: Phase 1 (authentication and teams). Still to do: Sentry on the app.

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

You need the server running first (see "How to run the server locally" above) and an Android phone with the Expo Go app, on the **same Wi-Fi** as your computer.

1. Find your computer's IP address on the Wi-Fi. On Windows, run `ipconfig` and look for **IPv4 Address** (it looks like `192.168.x.x`).
2. Check the server is reachable from your phone. Open `http://YOUR-IP:3000/health` in the phone's browser. You should see `{"status":"ok"}`.
3. Create `app/.env` with your computer's IP address:

   ```
   EXPO_PUBLIC_API_URL=http://YOUR-IP:3000
   ```

   Do not use `localhost` or `127.0.0.1`. On your phone, `localhost` means the phone itself, not your computer, so the app would never reach the server.
4. From the `app` folder, run:

   ```bash
   npm ci
   npx expo start -c
   ```

5. Scan the QR code with Expo Go.
6. For an Android development build that includes native Google sign-in, run `npx expo start --dev-client -c` instead of `npx expo start -c`, then open the app from that build.

**After you change `app/.env`**, stop Expo and start it again with `npx expo start -c`. Expo reads environment variables only when it starts, and `-c` clears its cache, so an old value would otherwise stay in use.

### Troubleshooting

- **"Unable to resolve host"**: the address in `app/.env` is still a placeholder or has a typo.
- **The app can't connect, but the phone browser can**: restart Expo with `npx expo start -c`.
- **The phone browser can't connect either**: allow Node.js through Windows Firewall on private networks, and check that both devices are on the same Wi-Fi.
- **Expo Go says the SDK doesn't match**: update Expo Go from the Play Store.

### Public environment variables

Anything starting with `EXPO_PUBLIC_` is bundled into the app and can be read by anyone who has it. Never put a secret in one.

| Variable | Why it is safe to expose |
|---|---|
| `EXPO_PUBLIC_API_URL` | It is only the server's address. It is not a secret, and the server checks every request anyway. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | It identifies Rota's Google OAuth client. It is a public client ID, not a password or private key. |

## App environment variables

| Name | Why it is safe |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | It is only the server address the app connects to. It is not a password, token, or secret key, so it is safe to include in the app bundle. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | It is a public OAuth client ID used by the app to ask Google for an ID token. It is not a secret. |

## Production note: app store billing rules

To be written before release

## Architecture

See the recorded decisions in [`docs/decisions/`](docs/decisions/).

## Key decisions

See [`docs/decisions/`](docs/decisions/).
