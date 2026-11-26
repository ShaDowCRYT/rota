import type { SwapRequestView } from './swapsApi';

export type SwapSubmitGuard = {
  claim: (shiftId: string) => boolean;
  release: (shiftId: string) => void;
  isClaimed: (shiftId: string) => boolean;
};

export function applyOptimisticSwap(
  existing: readonly SwapRequestView[] | undefined,
  request: SwapRequestView,
): SwapRequestView[] {
  const kept = (existing ?? []).filter(
    (item) => item.id !== request.id && !(item.shiftId === request.shiftId && item.status === 'pending'),
  );
  return [request, ...kept];
}

export function restoreSwapList(
  previous: readonly SwapRequestView[] | undefined,
): SwapRequestView[] | undefined {
  return previous ? [...previous] : undefined;
}

export function pendingSwapForShift(
  swaps: readonly SwapRequestView[] | undefined,
  shiftId: string,
): SwapRequestView | undefined {
  return swaps?.find((swap) => swap.shiftId === shiftId && swap.status === 'pending');
}

export function swapLabelForShift(
  swaps: readonly SwapRequestView[] | undefined,
  shiftId: string,
): string | null {
  return pendingSwapForShift(swaps, shiftId) ? 'Swap requested' : null;
}

export function createSwapSubmitGuard(): SwapSubmitGuard {
  const claimed = new Set<string>();
  return {
    claim: (shiftId) => {
      if (claimed.has(shiftId)) return false;
      claimed.add(shiftId);
      return true;
    },
    release: (shiftId) => {
      claimed.delete(shiftId);
    },
    isClaimed: (shiftId) => claimed.has(shiftId),
  };
}
