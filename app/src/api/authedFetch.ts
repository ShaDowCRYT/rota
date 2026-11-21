import { apiFetch } from './client';
import type { FetchLike, FetchResponse } from './types';

import { refresh as refreshApi, type RefreshResult } from '../features/auth/authApi';
import { ApiFailure, SessionEndedError } from '../features/auth/errors';
import { useSessionStore } from '../features/auth/session';
import { tokenStorage } from '../features/auth/tokenStorage';

export type AuthedFetchDeps = {
  fetcher: FetchLike;
  getAccessToken: () => string | null;
  getRefreshToken: () => Promise<string | null>;
  saveRefreshToken: (value: string) => Promise<void>;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  setAccessToken: (accessToken: string) => void;
  clearSession: () => Promise<void> | void;
};

export function createAuthedFetch(deps: AuthedFetchDeps): FetchLike {
  let refreshInFlight: Promise<string | null> | null = null;

  async function performRefresh(): Promise<string | null> {
    const stored = await deps.getRefreshToken();
    if (!stored) {
      await deps.clearSession();
      return null;
    }

    try {
      const tokens = await deps.refresh(stored);
      await deps.saveRefreshToken(tokens.refreshToken);
      deps.setAccessToken(tokens.accessToken);
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) {
        await deps.clearSession();
        return null;
      }
      throw error;
    }
  }

  function refreshOnce(): Promise<string | null> {
    if (!refreshInFlight) {
      refreshInFlight = performRefresh().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  return async function authedFetch(path, init = {}) {
    const first = await deps.fetcher(path, withBearer(init, deps.getAccessToken()));
    if (first.status !== 401) {
      return first;
    }

    const accessToken = await refreshOnce();
    if (!accessToken) {
      throw new SessionEndedError();
    }

    const retry = await deps.fetcher(path, withBearer(init, accessToken));
    if (retry.status === 401) {
      await deps.clearSession();
      throw new SessionEndedError();
    }
    return retry;
  };
}

function withBearer(init: RequestInit, accessToken: string | null): RequestInit {
  const headers = new Headers(init.headers);
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return { ...init, headers };
}

export const authedFetch = createAuthedFetch({
  fetcher: apiFetch,
  getAccessToken: () => useSessionStore.getState().accessToken,
  getRefreshToken: () => tokenStorage.read(),
  saveRefreshToken: (value) => tokenStorage.write(value),
  refresh: (refreshToken) => refreshApi(refreshToken),
  setAccessToken: (accessToken) => useSessionStore.getState().setAccessToken(accessToken),
  clearSession: async () => {
    try {
      await tokenStorage.delete();
    } finally {
      useSessionStore.getState().setSignedOut();
    }
  },
});

export type { FetchResponse };
