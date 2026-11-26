# 0028: Render deployment and trust proxy hops

## Status

Accepted

## Context

Rota needs a simple first deployment on Render (free Node web service, Frankfurt). The server already has Redis-backed rate limiting and uses `req.ip` semantics; Render terminates TLS and forwards requests through its proxy, so the server must be able to trust a configured number of proxy hops to see the real client IP.

## Decision

- Add `TRUST_PROXY_HOPS` env var: integer 0-3, default 0. When > 0, `app.set("trust proxy", TRUST_PROXY_HOPS)`. Default 0 preserves safe local behavior (spoofed `X-Forwarded-For` ignored).
- For Render public web service, set `TRUST_PROXY_HOPS=1`. Evidence: Render "How Render handles DDoS attacks" (https://render.com/articles/how-render-handles-ddos-attacks, fetched 2026-11-26) states traffic passes through Cloudflare and Render load balancers, apps should read `x-forwarded-for`, and shows Express `app.set('trust proxy', 1)`.
- Add root `render.yaml` Blueprint: `rota-api`, `runtime: node`, `region: frankfurt`, `plan: free`, `rootDir: server`, build `npm ci --include=dev && npm run build`, start `npm start`, health `/health`, `autoDeployTrigger: commit`, env vars with secrets `sync: false`. Format follows Render Blueprint YAML Reference (https://render.com/docs/blueprint-spec, fetched 2026-11-26).
- Add `scripts/smoke.mjs` (plain Node, GET-only) and README deploy/smoke instructions. No debug IP endpoint.

## Consequences

- Real client IP is available for rate limiting when `TRUST_PROXY_HOPS` matches deployed proxy hops; wrong value can misidentify clients. Post-deploy verification must confirm expected client IP behavior before increasing hops.
- Free Render instances sleep, cold-start slowly, and share limited CPU; background jobs remain in-process until a later slice.
