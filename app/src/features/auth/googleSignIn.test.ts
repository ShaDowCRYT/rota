import { describe, expect, it, vi } from 'vitest';

import type { AuthResult } from '../auth/authApi';
import { GoogleSignInFailure, mapError } from '../auth/errors';
import {
  createGoogleSignInFlow,
  GoogleCancelledError,
  type GoogleResponse,
  type GoogleSuccessResponse,
} from './googleSignIn';

const ID_TOKEN = 'google-id-token-value-that-must-not-be-stored';
const REFRESH_TOKEN = 'rota-refresh-token-value';
const ACCESS_TOKEN = 'rota-access-token-value';

const authResult: AuthResult = {
  user: { id: 'user-1', email: 'person@example.com' },
  accessToken: ACCESS_TOKEN,
  refreshToken: REFRESH_TOKEN,
};

function makeHelpers(errorCode: (error: unknown) => string | null = () => null) {
  return {
    isSuccess: (response: GoogleResponse): response is GoogleSuccessResponse =>
      response.type === 'success',
    isNoCredential: (response: GoogleResponse) => response.type === 'noSavedCredentialFound',
    isCancelled: (response: GoogleResponse) => response.type === 'cancelled',
    errorCode,
  };
}

function makeDeps(response: GoogleResponse = { type: 'success', data: { idToken: ID_TOKEN } }) {
  const client = {
    checkPlayServices: vi.fn(async () => undefined),
    signIn: vi.fn(async () => response),
    createAccount: vi.fn(
      async (): Promise<GoogleResponse> => ({ type: 'success', data: { idToken: ID_TOKEN } }),
    ),
    presentExplicitSignIn: vi.fn(
      async (): Promise<GoogleResponse> => ({ type: 'success', data: { idToken: ID_TOKEN } }),
    ),
  };
  const api = { googleSignIn: vi.fn(async () => authResult) };
  const storage = { write: vi.fn(async () => undefined) };
  const setSignedIn = vi.fn();
  const store = { getState: () => ({ setSignedIn }) };
  const debugCode = vi.fn();

  return {
    client,
    api,
    storage,
    setSignedIn,
    debugCode,
    deps: {
      client,
      helpers: makeHelpers(),
      api,
      storage,
      store,
      debugCode,
    },
  };
}

describe('Google sign-in flow', () => {
  it('calls the server once and stores only Rota tokens on success', async () => {
    const setup = makeDeps();
    const flow = createGoogleSignInFlow(setup.deps);

    await expect(flow.signIn()).resolves.toBeUndefined();

    expect(setup.api.googleSignIn).toHaveBeenCalledTimes(1);
    expect(setup.api.googleSignIn).toHaveBeenCalledWith(ID_TOKEN);
    expect(setup.storage.write).toHaveBeenCalledTimes(1);
    expect(setup.storage.write).toHaveBeenCalledWith(REFRESH_TOKEN);
    expect(setup.setSignedIn).toHaveBeenCalledWith(authResult.user, ACCESS_TOKEN);
    expect(setup.debugCode).not.toHaveBeenCalled();
    expect(JSON.stringify(setup.storage.write.mock.calls)).not.toContain(ID_TOKEN);
    expect(JSON.stringify(setup.debugCode.mock.calls)).not.toContain(ID_TOKEN);
  });

  it('does nothing when the user cancels', async () => {
    const setup = makeDeps({ type: 'cancelled', data: null });
    const flow = createGoogleSignInFlow(setup.deps);

    await expect(flow.signIn()).rejects.toBeInstanceOf(GoogleCancelledError);
    expect(setup.api.googleSignIn).not.toHaveBeenCalled();
    expect(setup.storage.write).not.toHaveBeenCalled();
    expect(setup.debugCode).not.toHaveBeenCalled();
  });

  it('uses the explicit flow only when no saved credential is found', async () => {
    const setup = makeDeps({ type: 'noSavedCredentialFound', data: null });
    setup.client.createAccount.mockResolvedValue({ type: 'cancelled', data: null });
    const flow = createGoogleSignInFlow(setup.deps);

    await expect(flow.signIn()).rejects.toBeInstanceOf(GoogleCancelledError);
    expect(setup.client.signIn).toHaveBeenCalledTimes(1);
    expect(setup.client.createAccount).toHaveBeenCalledTimes(1);
    expect(setup.client.presentExplicitSignIn).not.toHaveBeenCalled();
  });

  it('maps a native failure code without logging the raw error', async () => {
    const raw = 'RAW-NATIVE-GOOGLE-ERROR';
    const setup = makeDeps();
    setup.client.checkPlayServices.mockRejectedValue(new Error(raw));
    setup.deps.helpers.errorCode = (error) =>
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : null;
    setup.client.checkPlayServices.mockRejectedValue({ code: 'DEVELOPER_ERROR', message: raw });
    const flow = createGoogleSignInFlow(setup.deps);

    await expect(flow.signIn()).rejects.toBeInstanceOf(GoogleSignInFailure);
    expect(setup.debugCode).toHaveBeenCalledWith('DEVELOPER_ERROR');
    expect(JSON.stringify(setup.debugCode.mock.calls)).not.toContain(raw);
    expect(mapError(new GoogleSignInFailure('DEVELOPER_ERROR')).kind).toBe('google');
    expect(setup.api.googleSignIn).not.toHaveBeenCalled();
    expect(setup.storage.write).not.toHaveBeenCalled();
  });
});
