import { describe, expect, it, vi } from 'vitest';

import { fakeResponse, TEST_IDS } from '../../test/fakes';
import { FEED_PAGE_SIZE, listActivity } from './activityApi';

function eventBody() {
  return {
    items: [
      {
        id: 'event-1',
        type: 'shift_created',
        actorId: TEST_IDS.user,
        payload: { shiftId: TEST_IDS.shift },
        createdAt: '2026-01-05T09:00:00.000Z',
      },
    ],
    nextCursor: 'cursor-1',
  };
}

describe('listActivity', () => {
  it('sends the first page without a cursor and a limit at or below 50', async () => {
    const fetcher = vi.fn().mockResolvedValue(fakeResponse({ body: eventBody() }));

    const page = await listActivity(TEST_IDS.team, null, fetcher);

    expect(FEED_PAGE_SIZE).toBeLessThanOrEqual(50);
    expect(fetcher).toHaveBeenCalledWith(
      `/teams/${TEST_IDS.team}/activity?limit=${FEED_PAGE_SIZE}`,
      { method: 'GET' },
    );
    expect(fetcher.mock.calls[0][0]).not.toContain('cursor=');
    expect(page.nextCursor).toBe('cursor-1');
    expect(page.items[0]?.type).toBe('shift_created');
  });

  it('treats empty and undefined cursor placeholders as no cursor', async () => {
    for (const cursor of ['', 'undefined']) {
      const fetcher = vi.fn().mockResolvedValue(fakeResponse({ body: eventBody() }));
      await listActivity(TEST_IDS.team, cursor, fetcher);
      expect(fetcher.mock.calls[0][0]).toBe(
        `/teams/${TEST_IDS.team}/activity?limit=${FEED_PAGE_SIZE}`,
      );
    }
  });

  it('sends the server cursor on later pages', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      fakeResponse({ body: { items: [], nextCursor: null } }),
    );

    await listActivity(TEST_IDS.team, 'cursor+/=', fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      `/teams/${TEST_IDS.team}/activity?limit=${FEED_PAGE_SIZE}&cursor=cursor%2B%2F%3D`,
      { method: 'GET' },
    );
  });

  it('rejects a body without a cursor field', async () => {
    const fetcher = vi.fn().mockResolvedValue(fakeResponse({ body: { items: [] } }));
    await expect(listActivity(TEST_IDS.team, null, fetcher)).rejects.toMatchObject({ status: 200 });
  });

  it('rejects a non-UUID team id before sending', async () => {
    const fetcher = vi.fn();
    await expect(listActivity('undefined', null, fetcher)).rejects.toMatchObject({ status: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
