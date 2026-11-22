# 0019: Teams, invites, and password reset

Status: Accepted
Date: 2026-11-22
Source: Phase 1 server slices 5 and 6

## Problem

Phase 1 needs server-side teams, roles, team isolation, invite acceptance, and password reset. The schema is split into global and shard groups, so some writes cannot share a transaction. We also need single-use tokens and Redis rate limits without leaking secrets.

## Options

1. Add app screens and call the provider directly from the app. Rejected: this phase is server-only and the app must only call the Rota server.
2. Put `team_id` filters only in the app. Rejected: hiding a button protects nothing; RBAC must be checked on the server against the database.
3. Keep all new team-related tables in the shard group and use cross-group foreign keys. Rejected by decision 0011.
4. Use global tables for tokens and team lookup, a shard router for team data, and server-side services for all checks. Chosen.

## Decision

- `server/src/db/shard.ts` hashes `team_id` with SHA-256 and picks from a configured list. The list has one database now. Every shard-group query goes through `getShardFor(teamId)`.
- Team membership and role are read from the shard database on every request. A non-member receives 404 on a team-scoped route; a member with too low a role receives 403. The Owner-only rule comes from the PRD section 2.1 matrix.
- `POST /teams` is an authenticated-user action: the caller becomes the new team's Owner. It does not use `requireTeamRole` because no membership exists before creation.
- Owner invariant: changing or removing an Owner returns 403 with `Cannot change the owner` or `Cannot remove the owner`. Already a member returns 409. Wrong-email invite returns 403 with the same body as an invalid invite.
- Team creation writes the shard `teams` and `memberships` rows first in one shard transaction, then the global `user_teams` row with `ON CONFLICT DO NOTHING`. If the second write fails, the shard rows remain and the request returns 500. A retry is safe because the last step is idempotent; a repair job will reconcile stale `user_teams` rows before sharding. The same pattern is used for membership creation on invite acceptance, with compensation that removes the shard membership and releases the invite when the global lookup write fails. Both compensation calls ignore their own errors and the original error is still returned, so a compensation failure does not change the response; it leaves stale data for the same repair job.
- Invite and reset tokens use 32 random bytes in base64url. Only the SHA-256 hash is stored. Consume uses one atomic `UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING`, so exactly one racing request can win. Invites also require `revoked_at IS NULL`.
- Invite creation returns the deep link only. If an email is supplied, it is stored for the email-match check; sending an invite email is not added in this slice. Listing invites never returns the token or token hash.
- Password reset revokes all refresh tokens after the password hash is written. It works when `password_hash` is null. Forgot always returns the same 202 body for existing and unknown emails and does the same token generation/hash work in both paths.
- `EmailSender.send({ to, subject, text })` is injected through `createApp`. `DevEmailSender` logs the reset link only when `NODE_ENV` is `development` or `test`; otherwise it sends nothing and logs one "no email provider configured" line. No other code logs invite or reset tokens.
- Redis rate limits are fixed-window scripts: INCR and first-hit EXPIRE run atomically in Redis. Limits: invite create 30/hour/user, invite accept 20/15min/IP, forgot 5/hour/IP and 3/hour/hashed email, reset 10/15min/IP. Failure is closed with 503.
- Malformed JSON is mapped to 400 by the error handler, like other invalid request bodies.

## Why

- The server is the only security boundary, so role and team checks must use the database, not the client or access token.
- The no-cross-group-FK rule from decision 0011 makes explicit write order and idempotent retries necessary.
- Atomic token consumption is the only reliable way to make single-use invites and resets safe under concurrent requests.
- Logging raw tokens in production would make the token store irrelevant. The dev log exists only so a developer can finish the reset flow without an email provider.
- A Lua-style fixed-window script avoids a Redis key that increments forever if EXPIRE fails after INCR.

## When to revisit

- Phase 5 adds real seat checks inside `assertSeatAvailable`.
- Phase 6 moves shard tables to separate databases and replaces the one-entry router with a real database list.
- A real email provider replaces `DevEmailSender`.
