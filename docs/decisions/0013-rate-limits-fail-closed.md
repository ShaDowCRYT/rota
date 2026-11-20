# 0013: Rate limits fail closed

Status: Accepted
Date: 2026-11-19
Source: Phase 1, slice 2 (sign-up, login, access token, protected route)

## Problem

Sign-up and login are public endpoints and must be rate limited with Redis, never an in-memory counter (AGENTS.md rule 19, AUTH-8). We also need to decide what happens when Redis is down, whether a duplicate-email 409 is acceptable, and how the client IP is identified when the server sits behind a proxy.

## Options

1. **Redis fixed-window limits (INCR, then EXPIRE on the first hit); fail closed if Redis is unavailable.** Chosen.
2. **In-memory counters.** Rejected: they reset on restart, do not work across processes, and are banned by AGENTS.md.
3. **Fail open when Redis is down.** Rejected: it would leave sign-up and login unprotected during an outage.

## Decision

- `server/src/middleware/rateLimit.ts` implements a fixed-window limiter with `INCR` and `EXPIRE` on the first hit. Every key has an expiry.
- Limits: sign-up **5 per hour per IP**; login **10 per 15 minutes per IP** and **5 per 15 minutes per email**. The per-email key stores a SHA-256 hash of the lowercased email, never the email itself.
- Exceeding a limit returns 429 with a `Retry-After` header. If Redis fails, sign-up and login return 503 `{"error":"Service unavailable"}` and the real error is logged. This is fail-closed.
- The limiter uses `req.ip`. **Trust proxy is deliberately left unchanged in this slice.** At deployment behind a proxy or load balancer, `app.set("trust proxy", ...)` must be configured correctly so `req.ip` is the real client IP and not the proxy address.
- Duplicate sign-up returns 409 `{"error":"Email already in use"}`. We accept that this reveals that an email is already registered, because the user experience is worth more here and the login failure messages still hide which field was wrong.

## Why

- Redis is shared by all server processes and survives restarts, so one limit applies everywhere.
- `EXPIRE` on the first hit means keys cannot live forever, even if traffic stops.
- Hashing the email keeps personal data out of Redis keys and out of logs.
- Failing closed is safer than silently removing protection during a Redis outage.
- Catching the unique violation (rather than checking first) makes the 409 correct even when two sign-ups race.

## When to revisit

- When deploying (Phase 7): set trust proxy correctly and confirm `req.ip` is the client IP.
- When the login, password-reset, invite, payment-start, or expensive endpoints are built: add their Redis limits.
- If product decides duplicate-email 409 reveals too much, replace it with a generic response and send a "you already have an account" email instead.
- If Upstash latency makes two `INCR` calls per login too slow, consider a single atomic Lua script.
