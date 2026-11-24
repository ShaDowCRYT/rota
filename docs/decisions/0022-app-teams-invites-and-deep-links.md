# 0022: App teams, invites, and deep links

Status: Accepted
Date: 2026-11-23
Source: Phase 1 app slice 7b

## Problem

The app needs team screens, Owner-only member controls, invite and reset deep links, and Google sign-in. Tokens must never be logged or persisted, and hiding a button must never be mistaken for security.

## Options

1. Store invite and reset tokens in SecureStore so sign-in can continue after a restart. Rejected: raw link tokens would live on the device longer than needed and could be logged or backed up.
2. Keep deep-link tokens in a Zustand memory-only store and clear them after use. Chosen.
3. Show the created invite link from the TanStack Query cache. Rejected: the link would remain cached after the screen closed.
4. Call Google directly from the app and trust the returned ID token. Rejected: only the Rota server verifies Google tokens and owns sessions.
5. Hide Owner actions in the app and rely on that to protect the server. Rejected: the server checks role on every request; the app hides controls only to avoid confusion.

## Decision

- `app/src/features/links/pendingLinkStore.ts` holds one pending invite or reset token in memory. It has no persistence adapter and is cleared after use. If the app is closed first, the user opens the link again.
- `rota://invite?token=...` and `rota://reset?token=...` are handled by Expo Router file routes. The token is copied from route params into memory, then the route is replaced without the token.
- An invite link is shown only on the invite screen immediately after creation. The mutation state is reset after the link is copied to local screen state, and pending invite lists never contain a link.
- Google sign-in uses `react-native-nitro-google-signin` in an Android development build. It is configured once at app start from `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. The button is hidden when that public ID is missing.
- The Google ID token goes only from the native library to `POST /auth/google`. The app stores the Rota refresh token in SecureStore and the Rota access token in memory, using the same code path as email login. The ID token is never stored or logged.
- Native library errors are reduced to a status code for a development-only log and a friendly message. Cancellation shows nothing.
- Role checks in the app hide Owner-only controls. The server permission matrix remains the only security boundary.

## Why

- Memory-only link tokens limit exposure to the active app session and match the single-use design of invite and reset tokens.
- Showing the invite link once prevents old links from lingering in query caches or on later screens.
- Server-side Google verification prevents a client from inventing an identity. Storing only Rota tokens keeps token handling consistent across login methods.
- Hiding controls improves the experience; it is not access control.

## When to revisit

- If invite acceptance must survive an app restart, add a server-backed pending-invite endpoint instead of persisting a raw token.
- If email invite delivery is added, the link display rules can be revisited.
- If iOS is added, repeat Google OAuth client and URL scheme setup for iOS.
