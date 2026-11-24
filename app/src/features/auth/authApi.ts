import { apiFetch } from '../../api/client';
import { ensureOk, isRecord, parseJson } from '../../api/responses';
import type { FetchLike } from '../../api/types';

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

export async function googleSignIn(
  idToken: string,
  fetcher: FetchLike = apiFetch,
): Promise<AuthResult> {
  const response = await fetcher('/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  await ensureOk(response);
  return parseAuthResult(await parseJson(response));
}

export async function forgotPassword(
  email: string,
  fetcher: FetchLike = apiFetch,
): Promise<void> {
  const response = await fetcher('/auth/forgot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  await ensureOk(response);
}

export async function resetPassword(
  token: string,
  newPassword: string,
  fetcher: FetchLike = apiFetch,
): Promise<void> {
  const response = await fetcher('/auth/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
  await ensureOk(response);
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

function parseAuthResult(value: unknown): AuthResult {
  if (!isRecord(value)) throw new ApiFailure(200);
  const record = value as Record<string, unknown>;
  return {
    user: parseUser(record.user),
    ...parseTokens(record),
  };
}

function parseRefreshResult(value: unknown): RefreshResult {
  if (!isRecord(value)) throw new ApiFailure(200);
  return parseTokens(value);
}

function parseTokens(value: Record<string, unknown>): AuthTokens {
  const accessToken = value.accessToken;
  const refreshToken = value.refreshToken;
  if (typeof accessToken !== 'string' || accessToken.length === 0) throw new ApiFailure(200);
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) throw new ApiFailure(200);
  return { accessToken, refreshToken };
}

function parseUser(value: unknown): SessionUser {
  if (!isRecord(value)) throw new ApiFailure(200);
  if (typeof value.id !== 'string' || typeof value.email !== 'string') throw new ApiFailure(200);
  return { id: value.id, email: value.email };
}
