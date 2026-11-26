# App state map (STATE-1 to STATE-3)

Last updated: 2026-11-25

This is the map of where app data lives. The server is the source of truth for everything it owns. The app never calls the payment provider.

| Data | Lives in | Why | Stale / cache time |
|---|---|---|---|
| Access token, signed-in user, session status | Zustand (`features/auth/session`) | Fast in-memory client state; cleared on sign-out. Never persisted. | n/a |
| Refresh token | expo-secure-store only | Long-lived credential that must survive a restart. | n/a |
| Invite or reset token from a deep link | In-memory `features/links` store | Used once during sign-in; lost on restart so no token is left on disk. | n/a |
| My teams and my role | Server + TanStack query key `['teams']` | Shared by tabs; role is only a UI convenience, the server checks it again. | 60 s / 10 min |
| Team name | Server + TanStack `['team', teamId]` | Read-only team detail; 404 sends the user home. | 30 s / 5 min (root default) |
| Members and their emails | Server + TanStack `['team', teamId, 'members']` | Feed sentences and shift rows use these emails, never event payload emails. | 30 s / 5 min |
| Shifts for one week | Server + TanStack `['team', teamId, 'shifts', start, end]` | Server data, refetched by week and invalidated after writes. | 30 s / 5 min |
| Activity pages | Server + TanStack infinite query `['team', teamId, 'activity']` | Cursor pages are merged by id; `nextCursor` controls page 2+. | 30 s / 5 min |
| Swap requests | Server + TanStack `['team', teamId, 'swaps']` | Optimistic writes update this cache, then invalidate it. | 15 s / 2 min |
| Swap failure message | Zustand (`features/swaps/swapNoticeStore`) | Small app-only notice shown after returning to shift detail. | n/a |
| Settings | Server only until Phase 4 | Server sets `updated_at`; latest change wins. No real-time sync. | no cache yet |
| Subscription, payment status, credits, webhooks | Server only | Billing rules forbid caching these. | never cached |
| Invite link shown once | Component state | It is sensitive and is not stored after the screen closes. | n/a |
| Selected teammate, day chips, 15-minute chips, confirm panels | Component state | Local form choices only; nothing to share between screens. | n/a |
| Current week anchor | Component state | Only the Schedule screen needs it. | n/a |
| Offline shifts | Phase 4 only | Persisted offline shifts are deliberately not built in this phase. | n/a |

Why Zustand: it is tiny, has no cache or network layer, and is only for app-only state such as the session and a one-off message. TanStack Query owns every server response because it already handles stale data, refetching, invalidation, and optimistic rollback. SecureStore owns credentials; no AsyncStorage or localStorage is used.

Id safety: `team/[teamId]/_layout.tsx` validates the route id once, using only the first array item, and shares it through React context. Every team screen reads that shared id through `useTeamId`; an invalid id shows a friendly Back screen instead of crashing, and a screen outside the provider gives a clear development error. Every id-based team request also checks UUID shape before calling the server; no `"undefined"`, empty, or non-UUID id is sent. Dev warning logs include only the endpoint template, method, status, kind, and context — never ids, tokens, bodies, or secrets.

Times are displayed with `Intl` in the phone's local time zone and sent to the server as ISO strings with an offset.
