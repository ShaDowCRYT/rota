# 0021: Google sign-in and account linking

Status: Accepted
Date: 2026-11-22
Source: Developer approval for Phase 1 slice 7 decisions

## Problem

Rota needs email/password login and Google sign-in. Google sign-in must create a new user, link safely to an existing email/password user, and never let a Google identity claim a different account.

## Options

1. Magic link. Rejected: the developer chose Google sign-in.
2. `POST /auth/google {idToken}` with server-side token verification. Chosen.
3. App-side or provider-side account linking without server checks. Rejected: the server must own authentication and account security.

## Decision

- The endpoint is `POST /auth/google` with body `{ idToken }`.
- The server verifies the token with `jose` against Google's JWKS at `https://www.googleapis.com/oauth2/v3/certs`.
- Only RS256 is accepted. The issuer must be `accounts.google.com` or `https://accounts.google.com`.
- The audience must be `GOOGLE_WEB_CLIENT_ID`. The token must not be expired and must have `email_verified: true`.
- Email addresses are lowercased before lookup or creation.
- Successful response is `200` with `{ user: { id, email }, accessToken, refreshToken }`.
- Account linking uses the verified `sub` claim as `users.google_sub`.
- A matching Google `sub` signs in the same user.
- An existing email/password account with no `google_sub` is linked only after all checks pass. Linking sets `password_hash` to NULL and revokes all refresh tokens.
- An existing email with a different `google_sub` is rejected.
- A new email creates a new user.
- Concurrent first-time sign-ins are handled in one global transaction with unique violation retry and re-read.
- All invalid token and invalid linking cases return `401 {"error":"Invalid Google sign-in"}`.
- Missing `GOOGLE_WEB_CLIENT_ID` returns `503 {"error":"Google sign-in is not available"}` without stopping server startup.
- Google sign-in is rate limited to 20 requests per 15 minutes per IP. Redis failure returns `503` with `Retry-After: 900`.
- Password login for a Google-linked account uses a dummy hash so the response timing stays similar.
- The app sends the public web client ID as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; no secret or ID token is stored in app configuration.
- The Android application id is `com.shadowcryt.rota`.
- EAS uses one `development` profile: Android APK, internal distribution, and the development client.

## Why

These choices keep Google identity verification on the server, prevent silent account takeover by email match alone, and keep the app free of provider secrets.

## App build configuration

The developer supplied the public iOS URL scheme `com.googleusercontent.apps.937949466731-h1e9hrphbpnabvmi10tbl16t6se2b0jf` from an iOS OAuth client created for bundle id `com.shadowcryt.rota`. It is recorded in the config plugin options even though Rota builds Android only, because `react-native-nitro-google-signin` requires `iosUrlScheme` when no Google services file is supplied. No Google services file was added. The Android OAuth client with the SHA-1 fingerprint from EAS is still created by the developer in Google Cloud after the first build; that step is needed to prove Google sign-in on the Android development build in slice 7b.

## When to revisit

Revisit when an iOS build is added, when Google services files are supplied, or if Google changes its token endpoint or claim requirements.
