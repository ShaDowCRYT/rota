import { authedFetch as defaultAuthedFetch } from '../../api/authedFetch';
import type { FetchLike } from '../../api/types';

import * as defaultAuthApi from './authApi';
import { ApiFailure, mapError, SessionEndedError } from './errors';
import { useSessionStore as defaultStore } from './session';
import { createTokenStorage, tokenStorage as defaultStorage } from './tokenStorage';

type AuthApi = typeof defaultAuthApi;
type TokenStorage = ReturnType<typeof createTokenStorage>;
type SessionStore = typeof defaultStore;

export type AuthActionsDeps = {
  api: AuthApi;
  storage: TokenStorage;
  store: SessionStore;
  authedFetch: FetchLike;
};

export function createAuthActions(deps: AuthActionsDeps) {
  let bootstrapped = false;
  let bootstrapInFlight: Promise<void> | null = null;

  async function bootstrap(): Promise<void> {
    if (bootstrapped) return;
    if (bootstrapInFlight) return bootstrapInFlight;

    bootstrapped = true;
    deps.store.getState().setLoading();

    bootstrapInFlight = (async () => {
      try {
        const stored = await deps.storage.read();
        if (!stored) {
          deps.store.getState().setSignedOut();
          return;
        }

        const tokens = await deps.api.refresh(stored);
        await deps.storage.write(tokens.refreshToken);
        deps.store.getState().setAccessToken(tokens.accessToken);

        const user = await deps.api.getMe(deps.authedFetch);
        deps.store.getState().setSignedIn(user, tokens.accessToken);
      } catch (error) {
        if (
          (error instanceof ApiFailure && error.status === 401) ||
          error instanceof SessionEndedError
        ) {
          try {
            await deps.storage.delete();
          } finally {
            deps.store.getState().setSignedOut();
          }
          return;
        }
        deps.store.getState().setStartupError(mapError(error));
      } finally {
        bootstrapInFlight = null;
      }
    })();

    return bootstrapInFlight;
  }

  async function retryBootstrap(): Promise<void> {
    bootstrapped = false;
    await bootstrap();
  }

  async function signUp(email: string, password: string): Promise<void> {
    const result = await deps.api.signup(email, password);
    await deps.storage.write(result.refreshToken);
    deps.store.getState().setSignedIn(result.user, result.accessToken);
  }

  async function signIn(email: string, password: string): Promise<void> {
    const result = await deps.api.login(email, password);
    await deps.storage.write(result.refreshToken);
    deps.store.getState().setSignedIn(result.user, result.accessToken);
  }

  async function logout(): Promise<void> {
    let stored: string | null = null;
    try {
      stored = await deps.storage.read();
      if (stored) {
        await deps.api.logout(stored);
      }
    } catch {
      reportOfflineClear();
    } finally {
      try {
        await deps.storage.delete();
      } finally {
        deps.store.getState().setSignedOut();
      }
    }
  }

  async function logoutAll(): Promise<void> {
    const accessToken = deps.store.getState().accessToken;
    try {
      if (accessToken) {
        await deps.api.logoutAll(accessToken);
      }
    } catch {
      reportOfflineClear();
    } finally {
      try {
        await deps.storage.delete();
      } finally {
        deps.store.getState().setSignedOut();
      }
    }
  }

  return { bootstrap, retryBootstrap, signUp, signIn, logout, logoutAll };
}

function reportOfflineClear(): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('Logout server call failed; local session cleared.');
  }
}

export const authActions = createAuthActions({
  api: defaultAuthApi,
  storage: defaultStorage,
  store: defaultStore,
  authedFetch: defaultAuthedFetch,
});

export function bootstrapSession(): Promise<void> {
  return authActions.bootstrap();
}

export function retryBootstrap(): Promise<void> {
  return authActions.retryBootstrap();
}
