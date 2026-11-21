import { apiFetch } from '../../api/client';
import type { FetchLike, FetchResponse } from '../../api/types';

import { ApiFailure } from './errors';
import type { SessionUser } from './session';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthResult = {
  user: SessionUser;
} & AuthTokens;

export type RefreshResult = AuthTokens;

export async function signup(
  email: string,
  password: string,
  fetcher: FetchLike = apiFetch,
): Promise<AuthResult> {
  const response = await fetcher('/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  await ensureOk(response);
  return parseAuthResult(await parseJson(response));
}

export async function login(
  email: string,
  password: string,
  fetcher: FetchLike = apiFetch,
): Promise<AuthResult> {
  const response = await fetcher('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  await ensureOk(response);
  return parseAuthResult(await parseJson(response));
}

export async function refresh(
  refreshToken: string,
  fetcher: FetchLike = apiFetch,
): Promise<RefreshResult> {
  const response = await fetcher('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  await ensureOk(response);
  return parseRefreshResult(await parseJson(response));
}

export async function logout(
  refreshToken: string,
  fetcher: FetchLike = apiFetch,
): Promise<void> {
  const response = await fetcher('/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  await ensureOk(response);
}

export async function logoutAll(
  accessToken: string,
  fetcher: FetchLike = apiFetch,
): Promise<void> {
  const response = await fetcher('/auth/logout-all', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await ensureOk(response);
}

export async function getMe(fetcher: FetchLike): Promise<SessionUser> {
  const response = await fetcher('/me', { method: 'GET' });
  await ensureOk(response);
  return parseUser(await parseJson(response));
}

async function ensureOk(response: FetchResponse): Promise<void> {
  if (!response.ok) {
    throw new ApiFailure(response.status, parseRetryAfter(response));
  }
}

function parseRetryAfter(response: FetchResponse): number | undefined {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : undefined;
}

async function parseJson(response: FetchResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiFailure(response.status);
  }
}

function parseAuthResult(value: unknown): AuthResult {
  if (!value || typeof value !== 'object') throw new ApiFailure(200);
  const record = value as Record<string, unknown>;
  return {
    user: parseUser(record.user),
    ...parseTokens(record),
  };
}

function parseRefreshResult(value: unknown): RefreshResult {
  if (!value || typeof value !== 'object') throw new ApiFailure(200);
  return parseTokens(value as Record<string, unknown>);
}

function parseTokens(value: Record<string, unknown>): AuthTokens {
  const accessToken = value.accessToken;
  const refreshToken = value.refreshToken;
  if (typeof accessToken !== 'string' || accessToken.length === 0) throw new ApiFailure(200);
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) throw new ApiFailure(200);
  return { accessToken, refreshToken };
}

function parseUser(value: unknown): SessionUser {
  if (!value || typeof value !== 'object') throw new ApiFailure(200);
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.email !== 'string') throw new ApiFailure(200);
  return { id: record.id, email: record.email };
}
