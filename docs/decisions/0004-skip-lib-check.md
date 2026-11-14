# 0004: Enable skipLibCheck for drizzle-orm declarations

Status: Accepted
Date: 2026-11-14
Source: Task 2 (Drizzle client), type-check blocker

## Problem

With strict type checking on, TypeScript reported about 70 errors. Every error was inside `node_modules/drizzle-orm`'s own `.d.ts` files, not in Rota's source. They came from optional drivers that are not installed (`gel`, `mysql2`) and from generic types in drizzle's query builders. TypeScript 5.9.3 failed the same way, so the compiler version was not the cause.

AGENTS.md says not to disable a check to make a build pass, so this required a developer decision.

## Options

1. Enable `skipLibCheck` and keep full checking of Rota's source. Chosen.
2. Leave the setting alone and stop the task with a red build.

## Decision

Set `"skipLibCheck": true` in `server/tsconfig.json`.

## Consequences

- Third-party `.d.ts` files are not type-checked. Our `src` files remain under `strict` mode and are still fully checked.
- No runtime behavior changes.
- Revisit when drizzle-orm ships declarations that pass strict checking, or when its optional driver types become separate packages.
