import { describe, expect, it, vi } from 'vitest';

import { fakeResponse, TEST_IDS } from '../../test/fakes';
import { createShift, deleteShift, listShifts, updateShift } from './shiftsApi';

const from = '2026-01-05T00:00:00.000Z';
const to = '2026-01-12T00:00:00.000Z';

describe('shiftsApi', () => {
  it('uses the server response shape', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      fakeResponse({
        body: [
          {
            id: TEST_IDS.shift,
            assigneeId: TEST_IDS.member,
            startsAt: '2026-01-05T09:00:00.000Z',
            endsAt: '2026-01-05T17:00:00.000Z',
          },
        ],
      }),
    );

    const shifts = await listShifts(TEST_IDS.team, from, to, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      `/teams/${TEST_IDS.team}/shifts?from=2026-01-05T00%3A00%3A00.000Z&to=2026-01-12T00%3A00%3A00.000Z`,
      { method: 'GET' },
    );
    expect(shifts).toEqual([
      {
        id: TEST_IDS.shift,
        assigneeId: TEST_IDS.member,
        startsAt: '2026-01-05T09:00:00.000Z',
        endsAt: '2026-01-05T17:00:00.000Z',
      },
    ]);
  });

  it('rejects a bad body', async () => {
    const fetcher = vi.fn().mockResolvedValue(fakeResponse({ body: { id: TEST_IDS.shift } }));
    await expect(listShifts(TEST_IDS.team, from, to, fetcher)).rejects.toMatchObject({
      status: 200,
    });
  });

  it('rejects non-UUID ids before sending requests', async () => {
    const fetcher = vi.fn().mockResolvedValue(fakeResponse({ status: 204, body: null }));

    await expect(listShifts('undefined', from, to, fetcher)).rejects.toMatchObject({ status: 0 });
    await expect(
      createShift(TEST_IDS.team, {
        assigneeId: 'member-1',
        startsAt: from,
        endsAt: to,
      }, fetcher),
    ).rejects.toMatchObject({ status: 0 });
    await expect(updateShift(TEST_IDS.team, 'shift-1', {}, fetcher)).rejects.toMatchObject({
      status: 0,
    });
    await expect(deleteShift('team-1', TEST_IDS.shift, fetcher)).rejects.toMatchObject({
      status: 0,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
