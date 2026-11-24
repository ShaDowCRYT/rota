import type { FetchResponse } from './types';

import { ApiFailure } from '../features/auth/errors';

export async function ensureOk(response: FetchResponse): Promise<void> {
  if (!response.ok) {
    throw new ApiFailure(response.status, parseRetryAfter(response));
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
