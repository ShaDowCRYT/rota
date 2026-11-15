# Rota

A shift scheduling app for small teams, with seat-based billing.

[![CI](https://github.com/ShaDowCRYT/rota/actions/workflows/ci.yml/badge.svg)](https://github.com/ShaDowCRYT/rota/actions/workflows/ci.yml)

**Status:** In development. Phase 0 (foundations) is complete: server, PostgreSQL pool, Redis, CI.

## Demo

- GIF of the app (coming)
- Android build download (coming)
- Demo video (coming)
- Live backend URL (coming)

## Tech stack

- React Native with Expo, Android EAS development build
- Node.js LTS, Express, TypeScript (strict mode), Zod
- PostgreSQL with pooled connections
- Redis for cache, rate limits, and locks
- BullMQ for jobs
- Drizzle ORM with the `pg` driver
- Vitest for tests, k6 for load tests
- Sentry for error tracking on the app and the server

## How to run the server locally

1. Install Node.js (LTS).
2. Copy `.env.example` to `.env`.
3. Start Redis with Docker: `docker compose up -d`.
4. Set `REDIS_URL=redis://127.0.0.1:6379` in `.env`.
5. Add a Neon `DATABASE_URL` to `.env`.
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
