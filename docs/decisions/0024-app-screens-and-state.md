# 0024: App screens, feed paging, optimistic swaps, and offline timing

Status: Accepted
Date: 2026-11-25
Source: Phase 2/3 app continuation after the computer crash

## Problem

The server slice was complete, but the app still needed the Members, shift, Activity, and Swaps screens. Choices were needed for the week view, custom time input, feed request de-duplication, optimistic swap rollback, and when offline persistence belongs.

## Options

1. Week view with a native date/time picker. Rejected: a picker package is not installed and the rules forbid new packages.
2. Week view with our own 14 day chips and 15-minute time step buttons. Chosen.
3. Let fast scroll start several next-page requests. Rejected: FEED-5 requires duplicate-request prevention.
4. Allow one next-page request at a time, guarded by the cursor and an in-flight flag. Chosen.
5. Show "Swap requested" only after the server answer. Rejected: SWAP-4 requires an instant label.
6. Apply the label in `onMutate`, restore the cache in `onError`, and invalidate in `onSettled`. Chosen.
7. Persist offline shifts now with another storage package. Rejected: no new storage package is approved and offline work is Phase 4.
8. Keep offline persistence out of this slice. Chosen.

## Decision

- The Schedule screen keeps the Monday-based week view and opens shift detail from each shift card.
- Create and Edit shift use our own day chips for the next 14 days and buttons for every 15-minute time; all touch targets are at least 44 points and all buttons have accessibility labels.
- FlashList drives the Activity tab. TanStack `useInfiniteQuery` passes the server's `nextCursor`; no request is made when it is null or a page is already in flight. Pages are merged by id so an event cannot appear twice.
- Swap request is an optimistic TanStack mutation: `onMutate` writes a pending row, `onError` restores the saved cache and shows a friendly message, and `onSettled` invalidates swaps and shifts. A submit guard makes a double tap send one request.
- Persisted offline shifts and the airplane-mode demo move to Phase 4. This slice never stores shifts on the device.

## Why

- Our own inputs keep the build small and work with the existing token system.
- One request at a time prevents duplicate pages and makes the feed easy to reason about.
- Optimistic UI makes the app feel immediate while the server remains the authority.

## When to revisit

- Phase 4 adds BullMQ push jobs and persisted offline shifts.
- If FlashList changes its sizing API, keep tokens for spacing and re-run the type check.
