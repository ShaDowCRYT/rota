# 0009: App lint and CI

## Problem
The Expo app had no linting and the CI workflow only checked the server, so app TypeScript or code-quality issues could slip in unnoticed.

## Options
1. Add Expo's official ESLint setup (`eslint` + `eslint-config-expo`, matched to the SDK) with a flat config and an `app` job in CI mirroring server checks.
2. Use a custom ESLint config or a different linter/tooling stack for the app.

## Decision
Use option 1: install SDK-matched `eslint` and `eslint-config-expo` as dev dependencies, configure lint with `eslint-config-expo/flat`, add `"lint": "expo lint"`, and add a separate `app` CI job (Node 24, `working-directory: app`, npm cache on `app/package-lock.json`) running `npm ci`, `npx tsc --noEmit`, `npm run lint`, and `npm audit --omit=dev`.

## Why
- Matches the locked Expo/React Native stack and uses the official, SDK-compatible rules.
- Keeps CI consistent with the existing server job and requires no secrets (no `EXPO_PUBLIC_API_URL` set in CI).
- Catches type and lint issues early on every push/PR.

## When to revisit
- When upgrading the Expo SDK or TypeScript in a way that requires lint config changes.
- If CI speed or lint rules need tuning, or if production dependency audit findings require a coordinated dependency update.
