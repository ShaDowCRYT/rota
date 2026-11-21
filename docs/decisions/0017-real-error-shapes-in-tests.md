# 0017: Real error shapes in tests

Status: Accepted
Date: 2026-11-21
Source: Phase 1 bug fix (duplicate signup returned 500 and the app blamed the network)

## Problem

Tests used fake database errors whose shape did not match the real one, so a bug passed all tests and a normal user hit it on the first day. The real Drizzle error puts the Postgres code `23505` on `error.cause`, not on the error itself. The check looked only at the top level, so a duplicate email became a 500 `{"status":"error"}` instead of a 409 `{"error":"Email already in use"}`.

A related problem: the app told the user "can't reach server" when the server had answered with a 500. A 500 means the server WAS reached; only a missing response is a network problem.

## Options

1. **Keep using fake errors.** Rejected. Tests keep passing while production fails on the first normal request.
2. **Copy the real shape into the fakes.** Chosen for this phase. Capture the error from real Postgres, then build test errors with the same classes and property locations, including codes nested under `cause`.
3. **Run a real Postgres in CI as an integration test.** Attractive, but it needs CI database setup that is not in place yet. Planned before Phase 6.

## Decision

- Error handling tests must use error shapes captured from the real database, not convenient shapes that merely look similar.
- One helper reads a Postgres error code from the error itself or from any `cause` in the chain. Every place that needs a Postgres error code must use that helper.
- The app only reports a network problem when no response arrived. A 503 maps to `service-unavailable`; every other 5xx maps to `unknown` with "Something went wrong. Try again.". A 409 from signup maps to `email-taken` with "Email already in use".

## Why

- The real error was measured against the live database: class `DrizzleQueryError`, code `23505` at `error.cause.code`, with a `DatabaseError` as the cause. A top-level-only check can never see that code.
- Catching more errors would hide unrelated failures. Reading the real code location fixes only the unique violation.
- A response with status 500, 502, or 504 is proof of contact. Calling that a network fault sends the user to the wrong fix and hides a server bug.
- Fixed friendly messages keep raw server text, status values, and stack traces out of the UI.

## When to revisit

- When we add a real Postgres to CI, which I plan to do before Phase 6. The copied shapes in unit tests can then be checked against a real integration error, and the one-off duplicate-check script is no longer needed.
