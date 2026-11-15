# 0007: Error tracking with Sentry

Status: Accepted
Date: 2026-11-15
Source: Phase 0, error tracking setup

## Problem

The server can fail in ways the developer never sees: an unhandled Express error, a crashed background job, or a bad request path. We need errors reported somewhere useful for debugging without putting secrets, request bodies, cookies, or tokens into a third-party service. Local development and CI also need to run without contacting Sentry.

## Options

1. **Sentry for the server, with privacy scrubbing and an optional DSN.** Chosen.
2. **Local log files only.** No account or network needed, but nobody is alerted and logs can be lost.
3. **A different error-tracking service.** Possible, but it adds another provider, SDK, and setup without a clear benefit for this phase.

## Decision

- Use `@sentry/node` (version 11.12.0 when added) on the server.
- Sentry stays off unless `SENTRY_DSN` is set. `initSentry()` logs one line, `error tracking is off`, and returns `false` when the DSN is missing.
- `SENTRY_DSN` is an optional server environment variable. It is never put in the app or in an `EXPO_PUBLIC_` variable, and `.env.example` contains only the name.
- `NODE_ENV` is validated as `development`, `test`, or `production` and is sent as the Sentry environment. It defaults to `development`.
- The SDK uses `dataCollection: { userInfo: false }`. In Sentry v11 this replaces the removed `sendDefaultPii` option and keeps user identity out of events.
- A `beforeSend` hook removes `request.data` (request body), `request.cookies`, and any `authorization` header before an event leaves the server. Other safe headers stay so errors can still be debugged.
- The Express integration reports errors. After all routes, the server registers `Sentry.setupExpressErrorHandler(app)`, then its own error middleware. The app returns a generic `500 { "status": "error" }` and never sends the real error message to the client.
- Performance tracing and session tracking options are not enabled.
- Tests use a fake DSN and a fake transport. They never contact Sentry, PostgreSQL, or Redis. CI therefore needs no Sentry secret.
- One real test message was sent with a temporary script using the developer's local DSN, then the script was deleted.

## Why

- Sentry gives the developer a searchable record of server errors, with stack traces, without building an error dashboard.
- The optional DSN lets tests and CI run with no network access and no secret.
- Scrubbing happens in one place before sending, so a mistake in a route cannot leak a password, cookie, or bearer token.
- A generic response keeps internal details away from clients while the full error is still logged and reported.
- Using the vendor's Express integration avoids hand-written capture code and duplicate reports for the same handled error.

## When to revisit

- When `@sentry/node` gets a new major version. In v11, `sendDefaultPii` is gone and `setupExpressErrorHandler` is deprecated in favour of the Express integration's automatic capture, so the next upgrade should re-check both.
- If the server needs performance tracing, spans, or session health data, which are deliberately off now.
- If alert rules, release names, or source maps are added.
- If the app needs error tracking too. That would be a separate SDK and decision, and it must not reuse the server DSN.
- Switch to the automatic Express integration when the deprecated setupExpressErrorHandler is removed in a future Sentry version.
