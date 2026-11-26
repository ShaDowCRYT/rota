import { describe, expect, it, vi } from 'vitest';

import { fakeResponse, TEST_IDS } from '../../test/fakes';
import { ApiFailure, mapError } from '../auth/errors';
import { approveSwap, cancelSwap, listSwaps, rejectSwap, requestSwap } from './swapsApi';

const swap = {
  id: TEST_IDS.swap,
  shiftId: TEST_IDS.shift,
  requesterId: TEST_IDS.user,
  targetId: null,
  status: 'pending',
};

describe('swapsApi', () => {
  it('lists pending swaps for the team', async () => {
    const fetcher = vi.fn().mockResolvedValue(fakeResponse({ body: [swap] }));

    const result = await listSwaps(TEST_IDS.team, 'pending', fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      `/teams/${TEST_IDS.team}/swap-requests?status=pending`,
      { method: 'GET' },
    );
    expect(result).toEqual([swap]);
  });

  it('requests an open swap with an empty body', async () => {
    const fetcher = vi.fn().mockResolvedValue(fakeResponse({ status: 201, body: swap }));

    await requestSwap(TEST_IDS.team, TEST_IDS.shift, undefined, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      `/teams/${TEST_IDS.team}/shifts/${TEST_IDS.shift}/swap-requests`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({});
  });

  it('requests a targeted swap with the target id', async () => {
    const fetcher = vi.fn().mockResolvedValue(fakeResponse({ status: 201, body: swap }));

    await requestSwap(TEST_IDS.team, TEST_IDS.shift, TEST_IDS.member, fetcher);

    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      targetId: TEST_IDS.member,
    });
  });

  it('cancels, approves, and rejects with the right paths and bodies', async () => {
    const cancelFetcher = vi.fn().mockResolvedValue(fakeResponse({ status: 204 }));
    await cancelSwap(TEST_IDS.team, TEST_IDS.swap, cancelFetcher);
    expect(cancelFetcher.mock.calls[0][0]).toBe(
      `/teams/${TEST_IDS.team}/swap-requests/${TEST_IDS.swap}/cancel`,
    );

    const approveFetcher = vi.fn().mockResolvedValue(fakeResponse({ body: swap }));
    await approveSwap(TEST_IDS.team, TEST_IDS.swap, TEST_IDS.member, approveFetcher);
    expect(approveFetcher.mock.calls[0][0]).toBe(
      `/teams/${TEST_IDS.team}/swap-requests/${TEST_IDS.swap}/approve`,
    );
    expect(JSON.parse(String(approveFetcher.mock.calls[0][1]?.body))).toEqual({
      assigneeId: TEST_IDS.member,
    });

    const rejectFetcher = vi.fn().mockResolvedValue(fakeResponse({ body: swap }));
    await rejectSwap(TEST_IDS.team, TEST_IDS.swap, rejectFetcher);
    expect(rejectFetcher.mock.calls[0][0]).toBe(
      `/teams/${TEST_IDS.team}/swap-requests/${TEST_IDS.swap}/reject`,
    );
    expect(JSON.parse(String(rejectFetcher.mock.calls[0][1]?.body))).toEqual({});
  });

  it('turns the server duplicate and decided conflicts into friendly messages', async () => {
    const duplicate = vi.fn().mockResolvedValue(
      fakeResponse({ status: 409, body: { error: 'A swap request is already pending' } }),
    );
    await expect(
      requestSwap(TEST_IDS.team, TEST_IDS.shift, undefined, duplicate),
    ).rejects.toMatchObject({ reason: 'swap_already_pending' });

    const decided = vi.fn().mockResolvedValue(
      fakeResponse({ status: 409, body: { error: 'This request was already decided' } }),
    );
    try {
      await rejectSwap(TEST_IDS.team, TEST_IDS.swap, decided);
      throw new Error('Expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiFailure);
      expect(mapError(error, 'swap').message).toBe('This request was already decided');
    }
  });

  it('rejects non-UUID ids before sending requests', async () => {
    const fetcher = vi.fn().mockResolvedValue(fakeResponse({ status: 204 }));

    await expect(listSwaps('undefined', undefined, fetcher)).rejects.toMatchObject({ status: 0 });
    await expect(requestSwap(TEST_IDS.team, 'shift-1', undefined, fetcher)).rejects.toMatchObject({
      status: 0,
    });
    await expect(cancelSwap(TEST_IDS.team, 'swap-1', fetcher)).rejects.toMatchObject({ status: 0 });
    await expect(
      approveSwap(TEST_IDS.team, TEST_IDS.swap, 'user-2', fetcher),
    ).rejects.toMatchObject({ status: 0 });
    await expect(rejectSwap('team-1', TEST_IDS.swap, fetcher)).rejects.toMatchObject({ status: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
