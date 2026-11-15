# Rota

A shift scheduling app for small teams, with seat-based billing.

[![CI](https://github.com/ShaDowCRYT/rota/actions/workflows/ci.yml/badge.svg)](https://github.com/ShaDowCRYT/rota/actions/workflows/ci.yml)

**Status:** In development. Phase 0 (foundations) is in progress.

Done so far: Express server with health checks, PostgreSQL connection pool, Redis connection, automated tests, CI, and optional Sentry error tracking.

Still to do in Phase 0: the Expo mobile app shell.

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
- Sentry error tracking for the server
- Vitest, ESLint, and GitHub Actions CI

Planned:
- React Native with Expo (Android development build)
- BullMQ for background jobs
- Flutterwave in test mode for payments
- k6 for load tests

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

## Production note: app store billing rules

To be written before release

## Architecture

See the recorded decisions in [`docs/decisions/`](docs/decisions/).

## Key decisions

See [`docs/decisions/`](docs/decisions/).
