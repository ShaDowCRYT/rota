import { ApiError } from '../../api/client';

import type { AuthResult } from '../auth/authApi';
import { ApiFailure, GoogleSignInFailure } from '../auth/errors';
import type { SessionUser } from '../auth/session';

export class GoogleCancelledError extends Error {
  constructor() {
    super('Google sign-in cancelled');
    this.name = 'GoogleCancelledError';
  }
}

export type GoogleSuccessResponse = {
  type: 'success';
  data: { idToken: string };
};

export type GoogleResponse =
  | GoogleSuccessResponse
  | { type: 'noSavedCredentialFound'; data: null }
  | { type: 'cancelled'; data: null };

export type GoogleResponseHelpers = {
  isSuccess: (response: GoogleResponse) => response is GoogleSuccessResponse;
  isNoCredential: (response: GoogleResponse) => boolean;
  isCancelled: (response: GoogleResponse) => boolean;
  errorCode: (error: unknown) => string | null;
};

export type GoogleClient = {
  checkPlayServices: () => Promise<void>;
  signIn: () => Promise<GoogleResponse>;
  createAccount: () => Promise<GoogleResponse>;
  presentExplicitSignIn: () => Promise<GoogleResponse>;
};

export type GoogleSignInFlowDeps = {
  client: GoogleClient;
  helpers: GoogleResponseHelpers;
  api: { googleSignIn: (idToken: string) => Promise<AuthResult> };
  storage: { write: (value: string) => Promise<void> };
  store: {
    getState: () => {
      setSignedIn: (user: SessionUser, accessToken: string) => void;
    };
  };
  debugCode?: (code: string) => void;
};

function defaultDebugCode(code: string): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('Google sign-in failed', code);
  }
}

export function createGoogleSignInFlow(deps: GoogleSignInFlowDeps) {
  return {
    async signIn(): Promise<void> {
      const debugCode = deps.debugCode ?? defaultDebugCode;

      try {
        await deps.client.checkPlayServices();
        let response = await deps.client.signIn();
        if (deps.helpers.isNoCredential(response)) {
          response = await deps.client.createAccount();
        }
        if (deps.helpers.isNoCredential(response)) {
          response = await deps.client.presentExplicitSignIn();
        }
        if (deps.helpers.isCancelled(response)) {
          throw new GoogleCancelledError();
        }
        if (!deps.helpers.isSuccess(response) || !response.data) {
          throw new GoogleSignInFailure('UNKNOWN');
        }

        const result = await deps.api.googleSignIn(response.data.idToken);
        await deps.storage.write(result.refreshToken);
        deps.store.getState().setSignedIn(result.user, result.accessToken);
      } catch (error) {
        if (error instanceof GoogleCancelledError) throw error;
        if (
          error instanceof ApiFailure ||
          error instanceof ApiError ||
          error instanceof TypeError
        ) {
          throw error;
        }
        const code = deps.helpers.errorCode(error) ?? 'UNKNOWN';
        debugCode(code);
        throw new GoogleSignInFailure(code);
      }
    },
  };
}
