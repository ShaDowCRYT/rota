# 0020: EAS CLI use

Status: Accepted
Date: 2026-11-22
Source: Developer approval for EAS project setup

## Problem

Rota needs an Android development build from EAS. The app uses Expo, but `eas-cli` is not listed in `AGENTS.md` section 2, so its use needs approval before setup.

## Options

1. Use Expo Go. Rejected: the PRD requires an EAS Android development build, and push notifications do not work reliably in Expo Go.
2. Use `npx eas-cli` without adding it to project dependencies. Chosen.
3. Add `eas-cli` to project dependencies. Rejected: no project dependency change is needed for one-time account and project setup.

## Decision

- The developer approves using `npx eas-cli`.
- The developer runs `npx eas-cli login` locally so Expo credentials are never shown in chat, stored in the repo, or placed in environment variables.
- The developer chose `shadoweeee` as the EAS account that owns Rota.
- After login succeeds, the assistant may run `npx eas-cli init --account shadoweeee --non-interactive` to link the project to EAS.
- `eas-cli` is a one-time setup tool here. It is not added to `package.json`.

## Why

The PRD locks Android EAS development builds. Approval keeps the setup inside the locked platform choice without adding an unapproved package to the app.

## When to revisit

If EAS build scripts need `eas-cli` as a project dependency, stop and ask before adding it.
