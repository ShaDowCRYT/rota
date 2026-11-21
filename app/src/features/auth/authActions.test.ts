import { describe, expect, it, vi } from 'vitest';

import type * as AuthApiModule from './authApi';
import { createAuthActions } from './authActions';
import { useSessionStore } from './session';
import { createTokenStorage, REFRESH_TOKEN_KEY } from './tokenStorage';
import { fakeResponse } from '../../test/fakes';

function makeApi(overrides: Partial<Record<keyof typeof AuthApiModule, unknown>> = {}) {
  return {
    signup: vi.fn(async () => {
      throw new Error('not used');
    }),
    login: vi.fn(async () => {
      throw new Error('not used');
    }),
    refresh: vi.fn(async () => {
      throw new Error('not used');
    }),
    logout: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => undefined),
    getMe: vi.fn(async () => {
      throw new Error('not used');
    }),
    ...overrides,
  } as unknown as typeof AuthApiModule;
}

describe('authActions.logout', () => {
  it('clears local state even when the server call fails', async () => {
    const adapter = {
      getItemAsync: vi.fn(async () => 'stored-value'),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    };
    const api = makeApi({
      logout: vi.fn(async () => {
        throw new TypeError('offline');
      }),
    });
    const actions = createAuthActions({
      api,
      storage: createTokenStorage(adapter),
      store: useSessionStore,
      authedFetch: async () => fakeResponse(),
    });

    useSessionStore.getState().setSignedIn({ id: 'user-1', email: 'person@example.com' }, 'access-value');

    await expect(actions.logout()).resolves.toBeUndefined();

    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(adapter.deleteItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY);
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(useSessionStore.getState().accessToken).toBeNull();
    expect(useSessionStore.getState().user).toBeNull();
  });
});
