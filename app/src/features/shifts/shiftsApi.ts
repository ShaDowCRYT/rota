import { authedFetch as defaultAuthedFetch } from '../../api/authedFetch';
import { assertUuid } from '../../api/ids';
import { ensureOk, isRecord, parseJson } from '../../api/responses';
import type { FetchLike } from '../../api/types';

import { ApiFailure } from '../auth/errors';

export const SHIFT_STALE_TIME = 30_000;
export const SHIFT_GC_TIME = 5 * 60_000;

const LIST_SHIFTS = 'GET /teams/:teamId/shifts';
const CREATE_SHIFT = 'POST /teams/:teamId/shifts';
const UPDATE_SHIFT = 'PATCH /teams/:teamId/shifts/:shiftId';
const DELETE_SHIFT = 'DELETE /teams/:teamId/shifts/:shiftId';

export type Shift = {
  id: string;
  assigneeId: string;
  startsAt: string;
  endsAt: string;
};

function parseShift(value: unknown): Shift {
  if (!isRecord(value)) throw new ApiFailure(200);
  if (
    typeof value.id !== 'string' ||
    typeof value.assigneeId !== 'string' ||
    typeof value.startsAt !== 'string' ||
    typeof value.endsAt !== 'string'
  ) {
    throw new ApiFailure(200);
  }
  return {
    id: value.id,
    assigneeId: value.assigneeId,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
  };
}

export async function listShifts(
  teamId: string,
  fromIso: string,
  toIso: string,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<Shift[]> {
  assertUuid(teamId, LIST_SHIFTS, 'GET');
  const query = `from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;
  const response = await fetcher(`/teams/${encodeURIComponent(teamId)}/shifts?${query}`, {
    method: 'GET',
  });
  await ensureOk(response, LIST_SHIFTS, 'GET');
  const body = await parseJson(response);
  if (!Array.isArray(body)) throw new ApiFailure(200);
  return body.map(parseShift);
}

export async function createShift(
  teamId: string,
  input: { assigneeId: string; startsAt: string; endsAt: string },
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<Shift> {
  assertUuid(teamId, CREATE_SHIFT, 'POST');
  assertUuid(input.assigneeId, CREATE_SHIFT, 'POST');
  const response = await fetcher(`/teams/${encodeURIComponent(teamId)}/shifts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  await ensureOk(response, CREATE_SHIFT, 'POST');
  return parseShift(await parseJson(response));
}

export async function updateShift(
  teamId: string,
  shiftId: string,
  input: { assigneeId?: string; startsAt?: string; endsAt?: string },
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<Shift> {
  assertUuid(teamId, UPDATE_SHIFT, 'PATCH');
  assertUuid(shiftId, UPDATE_SHIFT, 'PATCH');
  if (input.assigneeId !== undefined) assertUuid(input.assigneeId, UPDATE_SHIFT, 'PATCH');
  const response = await fetcher(
    `/teams/${encodeURIComponent(teamId)}/shifts/${encodeURIComponent(shiftId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  await ensureOk(response, UPDATE_SHIFT, 'PATCH');
  return parseShift(await parseJson(response));
}

export async function deleteShift(
  teamId: string,
  shiftId: string,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<void> {
  assertUuid(teamId, DELETE_SHIFT, 'DELETE');
  assertUuid(shiftId, DELETE_SHIFT, 'DELETE');
  const response = await fetcher(
    `/teams/${encodeURIComponent(teamId)}/shifts/${encodeURIComponent(shiftId)}`,
    { method: 'DELETE' },
  );
  await ensureOk(response, DELETE_SHIFT, 'DELETE');
}
