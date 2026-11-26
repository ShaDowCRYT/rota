# 0026: Team creation limit and per-team roles

Status: Accepted
Date: 2026-11-26

## Context

Users can create teams. Without a cap, abusive or accidental team creation can grow without bound.

## Decision

- Any signed-in user can create a team, and roles are per team.
- A user can own at most 5 teams. `POST /teams` returns 409 with `"You have reached the limit of 5 teams"` when the owner already owns 5 teams.
- The owned-team count is checked through `user_teams` and the shard router, counting only memberships where the user role is `owner`.
- `POST /teams` is rate limited to 10 requests per hour per user with the existing Redis fixed-window limiter. When Redis is unavailable, the route fails closed with 503.

## Consequences

- Staff/manager membership in other teams does not block creating a team.
- The limit is enforced on the server; the app maps the 409 to the same friendly message.
