import { authedFetch as defaultAuthedFetch } from '../../api/authedFetch';
import { assertUuid } from '../../api/ids';
import { ensureOk, isRecord, parseJson } from '../../api/responses';
import type { FetchLike } from '../../api/types';

import { ApiFailure } from '../auth/errors';

export const SWAP_STALE_TIME = 15_000;
export const SWAP_GC_TIME = 2 * 60_000;

const LIST_SWAPS = 'GET /teams/:teamId/swap-requests';
const REQUEST_SWAP = 'POST /teams/:teamId/shifts/:shiftId/swap-requests';
const CANCEL_SWAP = 'POST /teams/:teamId/swap-requests/:requestId/cancel';
const APPROVE_SWAP = 'POST /teams/:teamId/swap-requests/:requestId/approve';
const REJECT_SWAP = 'POST /teams/:teamId/swap-requests/:requestId/reject';

export type SwapStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type SwapRequestView = {
  id: string;
  shiftId: string;
  requesterId: string;
  targetId: string | null;
  status: SwapStatus;
};

function isStatus(value: unknown): value is SwapStatus {
  return (
    value === 'pending' || value === 'approved' || value === 'rejected' || value === 'cancelled'
  );
}

function parseSwapRequest(value: unknown): SwapRequestView {
  if (!isRecord(value)) throw new ApiFailure(200);
  if (
    typeof value.id !== 'string' ||
    typeof value.shiftId !== 'string' ||
    typeof value.requesterId !== 'string' ||
    (typeof value.targetId !== 'string' && value.targetId !== null) ||
    !isStatus(value.status)
  ) {
    throw new ApiFailure(200);
  }
  return {
    id: value.id,
    shiftId: value.shiftId,
    requesterId: value.requesterId,
    targetId: value.targetId,
    status: value.status,
  };
}

export async function listSwaps(
  teamId: string,
  status: SwapStatus | undefined,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<SwapRequestView[]> {
  assertUuid(teamId, LIST_SWAPS, 'GET');
  const query = status ? `?status=${status}` : '';
  const response = await fetcher(`/teams/${encodeURIComponent(teamId)}/swap-requests${query}`, {
    method: 'GET',
  });
  await ensureOk(response, LIST_SWAPS, 'GET');
  const body = await parseJson(response);
  if (!Array.isArray(body)) throw new ApiFailure(200);
  return body.map(parseSwapRequest);
}

export async function requestSwap(
  teamId: string,
  shiftId: string,
  targetId: string | undefined,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<SwapRequestView> {
  assertUuid(teamId, REQUEST_SWAP, 'POST');
  assertUuid(shiftId, REQUEST_SWAP, 'POST');
  if (targetId !== undefined) assertUuid(targetId, REQUEST_SWAP, 'POST');
  const body: { targetId?: string } = targetId ? { targetId } : {};
  const response = await fetcher(
    `/teams/${encodeURIComponent(teamId)}/shifts/${encodeURIComponent(shiftId)}/swap-requests`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  await ensureOk(response, REQUEST_SWAP, 'POST');
  return parseSwapRequest(await parseJson(response));
}

export async function cancelSwap(
  teamId: string,
  requestId: string,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<void> {
  assertUuid(teamId, CANCEL_SWAP, 'POST');
  assertUuid(requestId, CANCEL_SWAP, 'POST');
  const response = await fetcher(
    `/teams/${encodeURIComponent(teamId)}/swap-requests/${encodeURIComponent(requestId)}/cancel`,
    { method: 'POST' },
  );
  await ensureOk(response, CANCEL_SWAP, 'POST');
}

export async function approveSwap(
  teamId: string,
  requestId: string,
  assigneeId: string | undefined,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<SwapRequestView> {
  assertUuid(teamId, APPROVE_SWAP, 'POST');
  assertUuid(requestId, APPROVE_SWAP, 'POST');
  if (assigneeId !== undefined) assertUuid(assigneeId, APPROVE_SWAP, 'POST');
  const body: { assigneeId?: string } = assigneeId ? { assigneeId } : {};
  const response = await fetcher(
    `/teams/${encodeURIComponent(teamId)}/swap-requests/${encodeURIComponent(requestId)}/approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  await ensureOk(response, APPROVE_SWAP, 'POST');
  return parseSwapRequest(await parseJson(response));
}

export async function rejectSwap(
  teamId: string,
  requestId: string,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<SwapRequestView> {
  assertUuid(teamId, REJECT_SWAP, 'POST');
  assertUuid(requestId, REJECT_SWAP, 'POST');
  const response = await fetcher(
    `/teams/${encodeURIComponent(teamId)}/swap-requests/${encodeURIComponent(requestId)}/reject`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  await ensureOk(response, REJECT_SWAP, 'POST');
  return parseSwapRequest(await parseJson(response));
}
