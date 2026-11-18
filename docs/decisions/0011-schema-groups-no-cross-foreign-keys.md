# 0011: Schema groups with no cross-group foreign keys

Status: Accepted
Date: 2026-11-18
Source: Task 5 (schema groups and migrations)

## Problem

In Phase 6 the shard tables move to separate databases, and a database cannot enforce a foreign key to a table in another database.

## Options

1. Use foreign keys everywhere now and remove them later.
2. Use no cross-group foreign keys from the start.
3. Give up on sharding.

## Decision

Use two schema groups with separate migrations, and no foreign keys across groups. The service checks that a user or team exists.

## Why

This avoids rewriting tables in Phase 6. It costs us database-enforced integrity across groups, so the service and tests must enforce it.

## When to revisit

In Phase 6, when the shard group moves to two databases.
