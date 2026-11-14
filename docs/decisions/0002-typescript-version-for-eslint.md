# 0002: Pin server TypeScript to 6.0.3 for ESLint

Status: Accepted
Date: 2026-11-14
Source: Task 3 (add ESLint), developer decision

## Context

The server was set up with TypeScript 7.0.2, the current npm stable. ESLint was then approved, but `typescript-eslint` 8.72.2 (latest, and the canary) declares a peer range of `>=4.8.4 <6.1.0`. npm refused to install the packages, and `--force` or `--legacy-peer-deps` would create an untested combination. The developer chose to have lint working now.

## Decision

Pin `typescript` to `6.0.3` (the latest version inside the supported range) in `server/package.json` devDependencies. Do not install with `--force` or `--legacy-peer-deps`.

## Consequences

- ESLint installs cleanly and runs with the `@eslint/js` and `typescript-eslint` recommended rules.
- No TypeScript 7-only syntax is used, so the build, type check, and tests are unchanged.
- Revisit this pin when `typescript-eslint` supports TypeScript 7, and upgrade both together.
- `npm audit` reports moderate advisories in the dependency tree; these were not auto-fixed.
