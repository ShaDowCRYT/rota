# 0003: Database pool size

Status: Accepted
Date: 2026-11-14
Source: Phase 0, database connection setup

## Problem

The server needs a PostgreSQL connection pool. Every open connection uses memory and a connection slot on the database. A pool that is too large can exhaust the database's connection limit when several server instances run. A pool that is too small makes requests wait for a free connection. We need a starting size and a reason for it.

## Options

1. **Pool max 5 per instance.** Safest on small databases, but may queue requests too early.
2. **Pool max 10 per instance, configurable with `DB_POOL_MAX`.** Chosen.
3. **Pool max 20 per instance.** More parallel queries, but multiplies quickly across instances.
4. **No pool (one connection per request).** Rejected: slow and wasteful.

## Decision

Use a pool maximum of **10 connections per server instance**, configurable with the `DB_POOL_MAX` environment variable (allowed range 1 to 20, default 10).

## Why

- **(a)** The Neon pooled connection string already shares connections through PgBouncer. That layer multiplexes many clients onto fewer real database connections, so our own pool can stay small.
- **(b)** The free database has small compute. Opening many connections would not make it faster; it would only add memory pressure and contention.
- **(c)** Every server instance creates its own pool. The number of instances multiplied by the pool size must stay well under the database's connection limit. Keeping the pool at 10 leaves room to add instances without exhausting the database.
- **(d)** 10 is a starting point, not a proven number. The Phase 6 load test will confirm it or change it based on measured latency and connection errors.

**Note:** With pooled (PgBouncer) connections, do not rely on session features such as `SET` commands or named prepared statements. Those belong to one session, and the pooler may hand the next query a different backend connection.

## When to revisit

- Phase 6 load testing shows requests waiting for a connection, or connection limit errors.
- The number of running server instances changes significantly.
- The database plan or its connection limit changes.
- We move from a pooled connection string to direct connections (without PgBouncer).
- Query latency or database CPU shows that fewer, longer-lived connections work better.
