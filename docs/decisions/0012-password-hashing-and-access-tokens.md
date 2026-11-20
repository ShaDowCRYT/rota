# 0012: Password hashing and access tokens

Status: Accepted
Date: 2026-11-19
Source: Phase 1, slice 2 (sign-up, login, access token, protected route)

## Problem

Phase 1 needs sign-up, login, and a protected route. We must choose how to store passwords and how to prove who is calling the protected route. This slice does not include refresh tokens, roles, teams, or password reset, so the choice must not secretly add those things.

## Options

1. **Argon2id via `@node-rs/argon2` plus an HS256 JWT via `jose`.** Argon2id is memory-hard and recommended for passwords; `jose` is a maintained JOSE library with strict algorithm pinning. Chosen.
2. **bcrypt via a new package.** Not approved in this project and does not add anything we need here.
3. **Roll our own token format or use a signed token with a role inside.** Rejected: a client-supplied role must never be trusted, and this slice has no roles.

## Decision

- Passwords are hashed with **Argon2id**, `memoryCost: 19456` KiB (19 MiB), `timeCost: 2`, `parallelism: 1`. These match the minimum configuration in the OWASP *Password Storage* Cheat Sheet, "Argon2id" section: <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#argon2id>.
- Access tokens are signed with **HS256** using `jose`. Fixed claims: issuer `rota`, audience `rota-app`, subject = user id, issued-at, and expiry from `ACCESS_TOKEN_TTL_SECONDS` (default 900 seconds = 15 minutes). **No role and no email** go in the token.
- Verification pins `algorithms: ["HS256"]` and checks issuer and audience, so `alg: none` and other algorithms are rejected.
- Sign-up, login, and `/me` responses never include the password hash. Logs include the user id only, never email, hashes, or tokens.
- Login failures always return the same 401 body: `{"error":"Invalid email or password"}`. When the email is unknown, we verify the password against a dummy Argon2id hash created lazily once, so unknown-email and wrong-password attempts take similar time. The database lookup still decides whether the user exists.

## Why

- Argon2id resists both GPU and side-channel attacks, and the chosen parameters are an OWASP minimum rather than a guess.
- A short-lived token limits the damage if one leaks. The lack of roles in the token means later role checks must read membership from the database, which is required by RBAC-1 and RBAC-3.
- Pinning the algorithm prevents algorithm-confusion attacks such as `alg: none`.
- Identical errors plus a dummy hash remove the easy timing signal that would otherwise reveal whether an email is registered.

## When to revisit

- When we add refresh tokens in the next slice: decide token rotation, family revocation, and where hashes are stored.
- When we move to a longer secret rotation plan: decide key IDs, overlapping secrets, and rotation windows.
- If OWASP changes its minimum Argon2id parameters, or we measure that the current cost is too slow under real load.
