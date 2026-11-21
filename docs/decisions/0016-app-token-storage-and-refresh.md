# 0016: App token storage and automatic refresh

Status: Accepted
Date: 2026-11-21
Source: Phase 1, slice 4 (sign-up, login, logout, and automatic refresh in the app)

## Problem

The app must survive a full app close without asking the user to log in again, while following the locked rule that tokens are stored with `expo-secure-store` only. The server uses strict one-time refresh tokens, so two simultaneous refreshes with the same token would revoke the whole token family. The app also needs to handle a lost refresh response and offline logout without leaking raw errors or keeping a usable credential in JavaScript state.

## Options

1. **Access token in Zustand memory only; refresh token in `expo-secure-store`; one shared refresh promise.** Chosen. A refresh starts only once, every 401 waits for it, and all calls retry once with the new access token.
2. **Both tokens in `expo-secure-store`.** Rejected. It adds a native read to every request and leaves a usable access token on disk.
3. **Let each screen refresh independently.** Rejected. Parallel refreshes would send the same refresh token twice and trigger the server's reuse detection.

## Decision

- The access token lives only in the Zustand session store. The refresh token lives only under the single `rota.refreshToken` key in `expo-secure-store`. `AsyncStorage`, files, and any public environment variable are never used for either token.
- `createAuthedFetch` keeps one `refreshInFlight` promise. On a 401 it reads the stored refresh token, calls `POST /auth/refresh`, saves the replacement token immediately, updates the memory access token, and retries the original request exactly once. A second 401 ends the session.
- Concurrent 401s share the same refresh. Tests use five simultaneous 401s and assert exactly one refresh call.
- A refresh that returns 401 clears the stored token and the session. A network error or 5xx keeps the stored token and session, sets a friendly retry state, and never logs out.
- On app start, the root layout calls `bootstrapSession()` once. With no stored token it goes to login. With a stored token it refreshes, loads `/me`, then enters the home route.
- Logout and log-out-all clear the stored token and memory session even when the server call fails, and resolve without exposing the raw error.
- Expo Router `Stack.Protected` guards the login/signup and home route groups. The loading route shows one retry state when startup fails.
- Errors are mapped to fixed friendly kinds and messages. Raw server text, stack traces, hosts, tokens, and passwords never reach the UI or logs. Technical detail is logged only under `__DEV__`, never token or password values.
- `react-dom` is pinned to `19.3.0` to match `react@19.3.0`. An earlier install attempt failed with `npm error code ERESOLVE` because npm selected `react-dom@19.3.1`; no forced or legacy install flags were used.
- Vitest configuration uses the `.mts` extension because the app package is CommonJS and Vite warned about ESM syntax in a `.ts` config.

## Why

- Keeping the access token in memory limits the damage from a JavaScript read or a dumped screen state.
- Strict refresh rotation on the server means the app must serialize refreshes; the shared promise is the smallest way to guarantee this.
- Saving the replacement refresh token before retrying means the old token is never reused by this app after a successful refresh.
- Offline logout still removes local access. The server-side family is already revocable from the server side on the next successful call, and the user sees no raw failure detail.
- Guarding routes in the router keeps unauthenticated screens out of the navigation tree instead of relying on hidden buttons.

## Accepted trade-offs

- If the refresh response is lost after the server has already accepted it, the app still holds the old refresh token. The next refresh will be seen as reuse and the user must log in again. This is rare, and adding a grace window would weaken the locked reuse-detection rule.
- Losing the access token on every full app close means one refresh on every cold start. That is intentional and covered by the startup flow.
- Offline logout clears local state but cannot guarantee the server-side family is revoked until a later successful server call.

## When to revisit

- If the app ever needs parallel background API clients, revisit only the transport layer; the single-flight promise must remain.
- If Sentry is added to the app, send only error kind and status fields, never tokens, passwords, or raw request bodies.
- If React Native or Expo requires a different `react-dom` version, change it together with `react` in one reviewed change.
