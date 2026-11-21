# 0018: Tests must not need configuration

Status: Accepted
Date: 2026-11-21
Source: Phase 1 CI bug (auth.test.ts exited at import when .env was missing)

## Problem

A test imported a module that loads real configuration, so it passed locally (where `.env` exists) and failed in CI (where it does not). The real error shape test imported the auth repository, which imported the database client, which imported the pool, which imported `config/env.ts`. With no `.env` and no settings in the environment, `env.ts` correctly called `process.exit(1)` during import. The other six test files passed because they never reached that module.

## Options

1. **Add fake environment variables to CI.** Rejected. It hides the real dependency and lets tests pass for the wrong reason.
2. **Stop `env.ts` from exiting or mock `process.exit`.** Rejected. The start-up check must still stop the server when settings are missing, and masking the exit hides the bug.
3. **Make tests and imports independent of configuration.** Chosen. Tests build real error objects with library classes only. Production modules receive their database and Redis clients when needed, so importing a module never loads configuration.

## Decision

- Tests must pass with no `.env` file and no environment variables.
- A test that needs only an error shape imports the error classes from the libraries and builds the object itself. It does not import the app's repository, database client, or pool.
- A production module that needs a database or Redis client receives it as an injected dependency. Merely importing that module must not create a client, read configuration, or touch the environment.
- `config/env.ts` keeps its start-up check exactly as it is. It still stops the server when settings are missing.
- A guard test removes all settings variables and imports every module under `src/modules` and `src/lib` (excluding `src/index.ts`). It proves that none of those imports calls `process.exit` or throws.

## Why

- CI should prove the code works on a clean machine. A green test that needed local secrets proves nothing about a clean checkout.
- Fake values would hide a real dependency instead of removing it. The next module imported by a test could fail in CI again.
- Keeping `process.exit` means the server still refuses to start without valid settings. We fix the import graph, not the safety check.
- Injected clients keep the application layer testable without a database and make the real start-up wiring explicit in `src/index.ts`.

## When to revisit

- When we add a real Postgres to CI as an integration test, which will need configuration on purpose and will live in a separate job. That job may set settings; the unit-test job in this workflow must not.
