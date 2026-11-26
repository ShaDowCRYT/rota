import { describe, expect, it } from 'vitest';

import type { ActivityPage } from './activityApi';
import { canFetchNextPage, createFeedPageGate, mergeFeedPages } from './feedMerge';

function page(ids: string[], nextCursor: string | null): ActivityPage {
  return {
    items: ids.map((id) => ({
      id,
      type: 'shift_created',
      actorId: 'user-1',
      payload: {},
      createdAt: '2026-01-05T09:00:00.000Z',
    })),
    nextCursor,
  };
}

describe('feed merge and request de-duplication', () => {
  it('merges pages by id so an event never appears twice', () => {
    const events = mergeFeedPages([
      page(['event-2', 'event-1'], 'cursor-1'),
      page(['event-1', 'event-3'], null),
    ]);

    expect(events.map((event) => event.id)).toEqual(['event-2', 'event-1', 'event-3']);
  });

  it('stops when the server cursor is null', () => {
    expect(
      canFetchNextPage({ nextCursor: null, hasNextPage: true, isFetchingNextPage: false }),
    ).toBe(false);
    expect(
      canFetchNextPage({ nextCursor: 'cursor-1', hasNextPage: true, isFetchingNextPage: false }),
    ).toBe(true);
  });

  it('ignores a second next-page call while one is in flight', () => {
    const gate = createFeedPageGate();
    const state = { nextCursor: 'cursor-1', hasNextPage: true, isFetchingNextPage: true };

    expect(gate.claim()).toBe(true);
    expect(canFetchNextPage(state) && gate.claim()).toBe(false);
    expect(gate.isClaimed()).toBe(true);

    gate.release();
    expect(canFetchNextPage({ ...state, isFetchingNextPage: false }) && gate.claim()).toBe(true);
  });
});
