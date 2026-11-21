# 0015: Refresh token rotation and reuse detection

Status: Accepted
Date: 2026-11-21
Source: Phase 1, slice 3 (refresh tokens, logout, log out of all devices)

## Problem

Access tokens last 15 minutes. We need a longer-lived credential that can be replaced without asking the user to log in again, without keeping a usable secret in the database, and without letting a stolen refresh token be used forever. AGENTS.md rules 17 and 18 require rotation on every use, 401 plus family revocation on reuse, and log-out-all.

## Options

1. **Strict one-time use with a family; a reused token revokes the whole family.** Chosen. One atomic SQL `UPDATE ... WHERE used_at IS NULL ... RETURNING` decides the winner, and any reuse revokes every token in that family.
2. **A short grace window where the old token still works for a few seconds after rotation.** Rejected. It gives a thief a small but real window to refresh after the owner has already rotated, and it needs extra state and timing rules. The app will send one refresh at a time, so it does not need overlap.
3. **Reusable refresh tokens with a global revoke list.** Rejected. It cannot detect reuse and it would keep every issued token alive until expiry.

## Decision

- A refresh token is 32 random bytes from `node:crypto` `randomBytes`, encoded as base64url. It is not a JWT. Only its SHA-256 hex hash is stored in `refresh_tokens.token_hash`; the plain value is returned to the client once.
- Lifetime is 30 days, set by `REFRESH_TOKEN_TTL_DAYS` (integer 1 to 90, default 30). A `family_id` groups every token descended from one signup or login.
- `consumeRefreshToken` is one atomic SQL statement. Exactly one concurrent request can mark a token used; every other request with that token gets no row.
- Reuse is detected after that statement: the whole family is revoked outside any transaction, then the request returns 401 `{"error":"Invalid or expired token"}`. Keeping the revoke outside the transaction means it is saved even though the request fails.
- The successful path wraps "consume the old token, check the user, create the new token" in one transaction, so a crash cannot leave a used token with no replacement.
- `POST /auth/refresh` is limited to 60 requests per 15 minutes per IP in Redis and fails closed with 503 when Redis is down.
- `POST /auth/logout` revokes the family of the supplied token and always returns 204, even for an unknown token. `POST /auth/logout-all` needs the access token and revokes every refresh token of that user.

## Why

- Storing only a hash means a database leak does not hand out usable refresh tokens.
- One-time use plus family revocation turns a stolen token into a detectable event: the thief and the owner cannot both keep refreshing.
- The atomic `UPDATE` makes the winner decided by the database, not by application timing. Five real-database runs of 50 simultaneous refreshes each produced exactly one 200 and 49 401s, with the family revoked every time.
- Hashing the user id into nothing extra keeps the token free of role or email claims, following the "never trust the client" rule.
- Failing closed on Redis outage matches the decision in 0013.

## Accepted trade-offs

- A stolen **access token** still works for up to 15 minutes after logout, because access tokens are not revoked individually. This is accepted: their lifetime is short, and adding a revocation list would add a new table and a lookup on every request.
- The app sends one refresh at a time, so no grace window is needed. A duplicate refresh is treated as theft, which is the safe failure direction.

## When to revisit

- When push, webhooks, email, or other slow work is built: add a BullMQ background job to delete expired and revoked refresh tokens. Cleanup is deliberately not in this slice.
- When the app is built: store both tokens with `expo-secure-store` and send a single refresh at a time; if the app ever needs parallel refreshes, revisit the grace-window decision.
- When deploying (Phase 7): set trust proxy correctly so the 60-per-15-minute limit uses the real client IP for `/auth/refresh`.
- If refresh lifetime must change, change `REFRESH_TOKEN_TTL_DAYS` in the environment, not the code.
