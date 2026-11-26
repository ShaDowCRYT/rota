# app/AGENTS.md: Rota mobile rules

These rules add to the root AGENTS.md. If they conflict, the root file wins.

## Design is built into the code
- All colors, font sizes, spacing, corner radii, and shadows live in app/src/theme/tokens.ts. Screens use tokens only. No hard-coded values like margin: 13 or color "#3a7".
- Spacing uses multiples of 4. Tokens support a light and a dark theme.
- Build screens from shared components in app/src/components (Text, Button, Card, Input, StateView). Do not style the same thing twice in two screens.
- Build screens in small groups. After each group, summarize what was built and wait for feedback only if the developer asked you to.

## Every screen
- Has a loading state, an empty state, and an error state with a Retry button. A blank screen is a bug.
- Accessibility: text contrast at least 4.5 to 1, touch targets at least 44 by 44 points, accessibilityLabel on every button and image, and text that scales with the phone's font size (no fixed heights on text).

## Data and state
- All server calls go through app/src/api. Components never call fetch directly.
- Server data uses TanStack Query only. App-only state uses Zustand.
- Tokens are stored in expo-secure-store only.

## Secrets
- Anything starting with EXPO_PUBLIC_ is public. Only non-secret values (like the API URL) may use it. List every EXPO_PUBLIC_ variable in the README with a reason it is safe.

## Limits for now
- No UI library, no new packages without asking. Use FlashList for long lists.
- Android only. Until a development build exists, do not use push notifications or native Google sign-in (Expo Go cannot run them).
- Write every file as UTF-8 without a byte order mark (BOM).