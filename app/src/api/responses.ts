import type { FetchResponse } from './types';

import { ApiFailure, readFailureReasonFromResponse } from '../features/auth/errors';

export async function ensureOk(
  response: FetchResponse,
  endpoint?: string,
  method?: string,
): Promise<void> {
  if (!response.ok) {
    const reason = await readFailureReasonFromResponse(response);
    throw new ApiFailure(response.status, parseRetryAfter(response), reason, endpoint, method);
  }
}

export function parseRetryAfter(response: FetchResponse): number | undefined {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : undefined;
}

export async function parseJson(response: FetchResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiFailure(response.status);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
