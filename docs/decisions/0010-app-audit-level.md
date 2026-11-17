# 0010: App audit level

## Problem
`npm audit` for `app/` reports 27 advisories (2 moderate, 25 high), all caused by picomatch (a ReDoS in glob matching) and minimatch, reached through Expo and Metro build tooling. npm lists no fixed version. The suggested fix, `npm audit fix --force`, would install `expo@52`, a downgrade from SDK 58 that breaks the app.

## Options
1. Force the fix.
2. Fail CI on high until Expo patches.
3. Fail only on critical and print the full report.

## Decision
Block CI only on critical issues for the app, and print the full report on every run. Never use `--force`.

## Why
The vulnerable code is build tooling that only handles glob patterns written by the developer; it does not ship in the app on users' phones. In an Expo app these tools are listed under `dependencies`, so `--omit=dev` does not exclude them. The server audit stays strict.

## When to revisit
When Expo, Metro, or picomatch releases a fix, and before any release build. At that point run `npm audit --omit=dev` and return to a stricter level if the report is clean.
