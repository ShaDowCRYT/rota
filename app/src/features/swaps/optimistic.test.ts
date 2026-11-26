import { describe, expect, it } from 'vitest';

import type { SwapRequestView } from './swapsApi';
import {
  applyOptimisticSwap,
  createSwapSubmitGuard,
  restoreSwapList,
  swapLabelForShift,
} from './optimistic';

const shiftId = 'shift-1';

function makeRequest(id: string): SwapRequestView {
  return {
    id,
    shiftId,
    requesterId: 'user-1',
    targetId: null,
    status: 'pending',
  };
}

type MutationResult = { sends: number; label: string | null };

async function runMutation(previous: SwapRequestView[], succeeds: boolean): Promise<MutationResult> {
  const guard = createSwapSubmitGuard();
  let cache: SwapRequestView[] | undefined = previous;
  let sends = 0;

  async function submit(): Promise<void> {
    if (!guard.claim(shiftId)) return;
    sends += 1;
    const snapshot = cache;
    const optimistic = makeRequest('optimistic-1');
    cache = applyOptimisticSwap(cache, optimistic);

    try {
      await Promise.resolve();
      if (!succeeds) throw new Error('forced failure');
      cache = applyOptimisticSwap(cache, makeRequest('server-1'));
    } catch {
      cache = restoreSwapList(snapshot);
    } finally {
      guard.release(shiftId);
    }
  }

  await Promise.all([submit(), submit()]);
  return { sends, label: swapLabelForShift(cache, shiftId) };
}

describe('optimistic swap cache', () => {
  it('keeps Swap requested after a success and sends only one request on a double tap', async () => {
    const result = await runMutation([], true);

    expect(result.sends).toBe(1);
    expect(result.label).toBe('Swap requested');
  });

  it('restores the previous cache value after a failure', async () => {
    const previous = [{ ...makeRequest('old-decided'), status: 'approved' as const }];
    const result = await runMutation(previous, false);

    expect(result.sends).toBe(1);
    expect(result.label).toBeNull();
    expect(restoreSwapList(previous)).toEqual(previous);
  });

  it('replaces an older pending row for the same shift', () => {
    const merged = applyOptimisticSwap([makeRequest('old-pending')], makeRequest('new-pending'));

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('new-pending');
  });
});
