import { describe, expect, it, vi } from 'vitest';

import { createAuthedFetch, type AuthedFetchDeps } from './authedFetch';
import type { FetchLike } from './types';
import { ApiFailure, SessionEndedError } from '../features/auth/errors';
import type { RefreshResult } from '../features/auth/authApi';
import { fakeResponse } from '../test/fakes';

type MakeDepsOptions = {
  fetcher?: FetchLike;
  getRefreshToken?: () => Promise<string | null>;
  saveRefreshToken?: (value: string) => Promise<void>;
  refresh?: (refreshToken: string) => Promise<RefreshResult>;
  clearSession?: () => Promise<void>;
};

function makeDeps(options: MakeDepsOptions = {}) {
  const fetcher = vi.fn(options.fetcher ?? (async () => fakeResponse()));
  const getRefreshToken = vi.fn(options.getRefreshToken ?? (async () => 'old-refresh'));
  const saveRefreshToken = vi.fn(options.saveRefreshToken ?? (async () => undefined));
  const refresh = vi.fn(
    options.refresh ??
      (async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh' })),
  );
  const setAccessToken = vi.fn();
  const clearSession = vi.fn(options.clearSession ?? (async () => undefined));

  const deps: AuthedFetchDeps = {
    fetcher,
    getAccessToken: () => 'old-access',
    getRefreshToken,
    saveRefreshToken,
    refresh,
    setAccessToken,
    clearSession,
  };

  return { deps, fetcher, getRefreshToken, saveRefreshToken, refresh, setAccessToken, clearSession };
}

describe('createAuthedFetch', () => {
  it('shares one refresh across five simultaneous 401 responses', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return calls <= 5
        ? fakeResponse({ status: 401 })
        : fakeResponse({ status: 200, body: { ok: true } });
    });
    const { deps, refresh, getRefreshToken, saveRefreshToken, setAccessToken } = makeDeps({ fetcher });
    const client = createAuthedFetch(deps);

    const results = await Promise.all(Array.from({ length: 5 }, () => client('/me')));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getRefreshToken).toHaveBeenCalledTimes(1);
    expect(saveRefreshToken).toHaveBeenCalledTimes(1);
    expect(setAccessToken).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(10);
    expect(results.every((result) => result.status === 200)).toBe(true);
  });

  it('clears the session and stored token when refresh returns 401', async () => {
    const fetcher = vi.fn(async () => fakeResponse({ status: 401 }));
    const { deps, clearSession, saveRefreshToken } = makeDeps({
      fetcher,
      refresh: async () => {
        throw new ApiFailure(401);
      },
    });
    const client = createAuthedFetch(deps);

    await expect(client('/me')).rejects.toBeInstanceOf(SessionEndedError);
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(saveRefreshToken).not.toHaveBeenCalled();
  });

  it('keeps the stored token and session on a network error during refresh', async () => {
    const networkError = new TypeError('Network request failed');
    const fetcher = vi.fn(async () => fakeResponse({ status: 401 }));
    const { deps, clearSession, getRefreshToken, saveRefreshToken } = makeDeps({
      fetcher,
      refresh: async () => {
        throw networkError;
      },
    });
    const client = createAuthedFetch(deps);

    await expect(client('/me')).rejects.toBe(networkError);
    expect(getRefreshToken).toHaveBeenCalledTimes(1);
    expect(clearSession).not.toHaveBeenCalled();
    expect(saveRefreshToken).not.toHaveBeenCalled();
  });

  it('saves the new refresh token and never reuses the old one', async () => {
    let stored = 'old-refresh';
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return calls % 2 === 1
        ? fakeResponse({ status: 401 })
        : fakeResponse({ status: 200, body: { ok: true } });
    });
    const refresh = vi.fn(async (refreshToken: string) => ({
      accessToken: `access-${refreshToken}`,
      refreshToken: `next-${refreshToken}`,
    }));
    const { deps, saveRefreshToken } = makeDeps({
      fetcher,
      getRefreshToken: async () => stored,
      saveRefreshToken: async (value) => {
        stored = value;
      },
      refresh,
    });
    const client = createAuthedFetch(deps);

    await client('/me');
    await client('/me');

    expect(refresh.mock.calls[0]?.[0]).toBe('old-refresh');
    expect(refresh.mock.calls[1]?.[0]).toBe('next-old-refresh');
    expect(saveRefreshToken.mock.calls[0]?.[0]).toBe('next-old-refresh');
    expect(saveRefreshToken.mock.calls[1]?.[0]).toBe('next-next-old-refresh');
  });

  it('ends the session after a second 401 without looping', async () => {
    const fetcher = vi.fn(async () => fakeResponse({ status: 401 }));
    const { deps, refresh, clearSession } = makeDeps({ fetcher });
    const client = createAuthedFetch(deps);

    await expect(client('/me')).rejects.toBeInstanceOf(SessionEndedError);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(clearSession).toHaveBeenCalledTimes(1);
  });
});
