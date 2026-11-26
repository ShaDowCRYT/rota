# 0025: Team id provider for nested team tabs

Status: Accepted
Date: 2026-11-25
Source: Android development-build bug report for Members, Activity, and Swaps

## Problem

The first tab, Schedule, had `teamId` in its local route params. Members, Activity, and Swaps had no local `teamId`, while the global URL still had it. Because each screen called `useLocalSearchParams`, those tabs threw a development error and never loaded team data.

## Options

1. Change every tab to read `useGlobalSearchParams`. Rejected: the global URL can differ from the mounted component's route, and the Expo docs warn that several nested pages can be mounted at once.
2. Add a hard-coded `href` with `teamId` to every tab. Rejected: it repeats the same param in four places and can drift from the parent route.
3. Validate `teamId` once in `team/[teamId]/_layout.tsx` and share it through React context. Chosen.

## Decision

- The team layout reads the local route param once. If it is an array, only the first item is used.
- The layout validates UUID shape and supplies the value through `TeamIdProvider`.
- An invalid or missing id shows a friendly "Team not found" screen with a Back button. Production never renders team children with an invalid id.
- `useTeamId` reads only the context. It never calls a route-param hook and gives a clear development error outside the provider.
- The API-layer UUID guard stays unchanged.

## Why

Expo Router notation makes `[teamId]` a dynamic route, and the layout is rendered before its child routes. The URL parameters guide says `useLocalSearchParams` belongs to the current component while `useGlobalSearchParams` follows the global URL. One provider keeps all tabs on the same team without depending on which tab is mounted.

Sources: `https://docs.expo.dev/router/basics/notation`, `https://docs.expo.dev/router/reference/url-parameters`, `https://docs.expo.dev/router/advanced/nesting-navigators`, `https://docs.expo.dev/router/advanced/tabs`.

## When to revisit

If Expo Router changes nested param behavior, re-check the layout param and keep the context boundary. Do not return to per-screen `teamId` route reads.
