# 0006: Continuous integration with GitHub Actions

Status: Accepted
Date: 2026-11-15
Source: Phase 0, continuous integration setup

## Problem

Changes to the server can break the build, the type check, the tests, or the lint rules. Right now those checks only run when a developer remembers to run them locally. A broken change can then reach `main` and only be noticed later. We need an automatic check that runs for every push and pull request and gives the same result every time, without needing secrets or real services.

## Options

1. **GitHub Actions CI workflow.** GitHub runs the checks on a fresh Ubuntu machine for every push and pull request. Chosen.
2. **Manual local checks only.** Free and simple, but easy to skip, and each developer can run different commands.
3. **A third-party CI service.** Possible, but adds another account, another configuration, and another place to maintain.

## Decision

Add `.github/workflows/ci.yml` with one job on `ubuntu-latest` and Node.js 24 (LTS), working in `server/`. The steps run in this order:

1. `actions/checkout@v7` gets the code.
2. `actions/setup-node@v7` installs Node 24 and caches npm downloads using `server/package-lock.json`.
3. `npm ci` installs exact locked dependencies.
4. `npx tsc --noEmit` type-checks without writing files.
5. `npm run lint` runs ESLint.
6. `npm test` runs the Vitest suite with fake checks.
7. `npm run build` compiles to `dist/`.
8. `npm audit --omit=dev` checks production dependencies for known vulnerabilities.

Workflow permissions are read-only for `contents`. The workflow runs on every push to `main` and on every pull request.

## Why

- CI catches broken code before it is merged instead of after.
- It runs the same checks, in the same order, every time, on a clean machine, so results do not depend on one developer's setup.
- No secrets are needed because the tests use fake database and Redis checks. CI never connects to a real database or Redis.
- Checking types and linting before tests and the build gives fast feedback: a type or style error is reported in seconds, before slower steps run.
- `npm ci` uses the committed lockfile, so CI installs exactly the versions that were tested locally.

## When to revisit

- When the mobile app is added and needs its own CI job.
- When tests need a real PostgreSQL or Redis service, which would change the "no secrets, no real services" choice.
- When we want coverage reporting, security scanning, or deployment from CI.
- If GitHub Actions minutes, runners, or permissions change, or CI becomes slow enough to need splitting into parallel jobs.
