# 0005: Redis in Docker for local development

Status: Accepted
Date: 2026-11-15
Source: Phase 0, Redis connection setup

## Problem

The server needs Redis. Redis will hold cache entries, rate-limit counters, and later the BullMQ job queues. We need a Redis instance for local development, and a different one for the deployed backend. Both must work through the same code. We need to choose how to run Redis locally without using up a hosted plan's quota.

## Options

1. **Upstash free plan for local development.** Managed, no local install, but the free plan has a monthly command limit.
2. **Redis in Docker for local development, Upstash for the deployed backend.** Chosen.

## Decision

- Local development uses **Redis in Docker** (`docker-compose.yml`, `redis:7-alpine` on `127.0.0.1:6379`).
- The deployed backend uses **Upstash** over TLS with a `rediss://` URL.
- Only the `REDIS_URL` environment variable changes between environments. The application code stays the same.

## Why

- The Upstash free plan has a monthly command limit. BullMQ sends steady traffic (polling and heartbeats) even when the app is idle, so local development and load tests would burn through that limit.
- Local Redis has no command limit, responds faster, and load tests cannot use up any hosted quota.
- Docker Redis matches the production Redis commands closely, so behavior is realistic while developing.
- Because both environments speak the Redis protocol, one client setup works for both. Only `REDIS_URL` differs: `redis://` locally and `rediss://` (TLS) when deployed.

## When to revisit

- When the backend is deployed (Phase 7), confirm the Upstash connection, TLS, and command usage.
- If local development needs features that managed Upstash handles differently (for example TLS-only behavior or connection limits).
- If load testing needs a Redis instance that is closer to the production plan's limits.
