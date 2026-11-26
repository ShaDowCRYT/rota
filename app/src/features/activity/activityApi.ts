import { authedFetch as defaultAuthedFetch } from '../../api/authedFetch';
import { assertUuid } from '../../api/ids';
import { ensureOk, isRecord, parseJson } from '../../api/responses';
import type { FetchLike } from '../../api/types';

import { ApiFailure } from '../auth/errors';

export const FEED_STALE_TIME = 30_000;
export const FEED_GC_TIME = 5 * 60_000;
export const FEED_PAGE_SIZE = 20;

const LIST_ACTIVITY = 'GET /teams/:teamId/activity';

export type ActivityEvent = {
  id: string;
  type: string;
  actorId: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ActivityPage = {
  items: ActivityEvent[];
  nextCursor: string | null;
};

function parseEvent(value: unknown): ActivityEvent {
  if (!isRecord(value)) throw new ApiFailure(200);
  if (
    typeof value.id !== 'string' ||
    typeof value.type !== 'string' ||
    typeof value.actorId !== 'string' ||
    typeof value.createdAt !== 'string'
  ) {
    throw new ApiFailure(200);
  }
  return {
    id: value.id,
    type: value.type,
    actorId: value.actorId,
    payload: isRecord(value.payload) ? value.payload : {},
    createdAt: value.createdAt,
  };
}

export async function listActivity(
  teamId: string,
  cursor: string | null,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<ActivityPage> {
  assertUuid(teamId, LIST_ACTIVITY, 'GET');
  const safeCursor = cursor && cursor !== 'undefined' ? cursor : null;
  const query = safeCursor
    ? `limit=${FEED_PAGE_SIZE}&cursor=${encodeURIComponent(safeCursor)}`
    : `limit=${FEED_PAGE_SIZE}`;
  const response = await fetcher(`/teams/${encodeURIComponent(teamId)}/activity?${query}`, {
    method: 'GET',
  });
  await ensureOk(response, LIST_ACTIVITY, 'GET');
  const body = await parseJson(response);
  if (!isRecord(body) || !Array.isArray(body.items)) throw new ApiFailure(200);
  if (body.nextCursor !== null && typeof body.nextCursor !== 'string') throw new ApiFailure(200);

  return {
    items: body.items.map(parseEvent),
    nextCursor: body.nextCursor,
  };
}
