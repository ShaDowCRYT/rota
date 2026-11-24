# 0023: Shifts, activity feed, and swap requests

Status: Accepted
Date: 2026-11-24
Source: Phase 2/3 server slice

## Problem

The server needs shift CRUD, an activity feed that survives equal timestamps, and atomic swap approval. The work is server-only; app screens, push notifications, settings, and billing are later phases.

## Options

1. Use offset pagination for the feed. Rejected: rows can be skipped or repeated when new events arrive between requests.
2. Use keyset pagination on `(created_at, id)` with the exact PostgreSQL timestamp text encoded in the cursor. Chosen.
3. Round-trip cursor timestamps through JavaScript `Date`. Rejected: milliseconds formatting loses microsecond precision and makes an exact cursor invalid.
4. Add an index on `team_id` only. Rejected: the feed still sorts and the row comparison cannot use index order.
5. Add `(team_id, created_at DESC, id DESC)`. Chosen; measured plans are saved in `docs/perf/feed-explain.md`.
6. Approve swaps with two separate updates and hope both succeed. Rejected: the shift and request would be able to disagree.
7. Approve swaps in one shard transaction with an advisory lock on the sorted set of involved people, then check overlap again before writing. Chosen.
8. Send swap push notifications inside the request. Rejected: push is slow work and belongs in a background job. It is deferred to Phase 4.
9. Build app screens in this task. Rejected: the developer asked for server-only work and the PRD puts the demo in later phases.

## Decision

- New shard tables are `shifts`, `swap_requests`, and `activity_events`. No global table has a foreign key to a shard table and no shard table has a foreign key to a global table.
- `GET /teams/:teamId/activity` uses a base64url cursor containing `{t, i}`. `t` is the exact `created_at::text` value from PostgreSQL and `i` is the row UUID. The next page queries `(created_at, id) < (cursorTime::timestamptz, cursorId::uuid)`.
- Cursor validation accepts optional fractional seconds because PostgreSQL omits them for whole-second values. It still rejects reformatted timestamps such as ISO `T`/`Z` text.
- The feed query qualifies its sort columns as `activity_events.created_at` and `activity_events.id`. Without the qualifier, `ORDER BY id` resolves to the `id::text` output alias and the index cannot provide ordering.
- Migration `0001` creates the three tables. Migration `0002` adds `activity_events_team_created_id_idx`.
- Shift create, update, and delete use the same per-assignee advisory lock idea as swap approval. A shift may not exceed 24 hours, start more than one year ahead, overlap another shift for the same person, or be assigned to a non-member.
- Changing a shift's assignee cancels its pending swap request in the same transaction and records a `swap_cancelled` feed event.
- `swap_requests_one_pending_idx` is a partial unique index on `(shift_id) WHERE status = 'pending'`, so one shift can never have two pending swaps.
- A swap request can only be made on the caller's own future shift. `targetId: null` means open to the team; a supplied `targetId` must be another member of that team. Only an owner or manager may approve or reject. The requester may cancel their own pending request.
- Approval re-checks that the shift is still assigned to the requester and that the new assignee has no overlapping shift. The swap status, shift assignee, and feed events are written in one transaction.
- Push notifications for swap events are not sent in this phase. Phase 4 will queue them through BullMQ.
- `server/scripts/seed-activity.ts` seeds 10,000 events per team in groups of five identical timestamps. `--team <uuid>` seeds the existing team and five `seed-*` teams; without it, six `seed-*` teams are created. `--cleanup` removes only `seed-*` data.

## Why

- Exact cursor text and the UUID tie-breaker make equal timestamps safe; the real database proof returned the same ordered IDs before and after the index.
- The composite index matches the feed's filter and sort. The measured execution time fell from `7.748 ms` to `0.092 ms` and shared buffers from `1715` to `4`.
- One transaction and explicit locks prevent a swap from being half approved.
- Keeping push out of the request matches the locked rule that slow work runs in BullMQ jobs.

## When to revisit

- Phase 4 adds BullMQ jobs for swap notifications and must respect quiet hours and invalid-token removal.
- Phase 6 may move the shard router from one database to two; these repositories already go through `getShardFor(teamId)`.
- If a different database is used, re-run `EXPLAIN ANALYZE` because plan costs and index choice can differ.
