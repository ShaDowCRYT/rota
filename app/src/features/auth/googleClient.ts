import {
  GoogleOneTapSignIn,
  isErrorWithCode,
} from 'react-native-nitro-google-signin';

import type {
  GoogleClient,
  GoogleResponse,
  GoogleResponseHelpers,
  GoogleSuccessResponse,
} from './googleSignIn';

let configured = false;

export function configureGoogle(webClientId: string): void {
  if (configured) return;
  try {
    GoogleOneTapSignIn.configure({ webClientId });
    configured = true;
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__ && isErrorWithCode(error)) {
      console.warn('Google sign-in configuration failed', error.code);
    }
  }
}

export const nativeGoogleClient: GoogleClient = {
  checkPlayServices: () => GoogleOneTapSignIn.checkPlayServices(),
  signIn: () => GoogleOneTapSignIn.signIn() as Promise<GoogleResponse>,
  createAccount: () => GoogleOneTapSignIn.createAccount() as Promise<GoogleResponse>,
  presentExplicitSignIn: () =>
    GoogleOneTapSignIn.presentExplicitSignIn() as Promise<GoogleResponse>,
};

export const nativeGoogleHelpers: GoogleResponseHelpers = {
  isSuccess: (response): response is GoogleSuccessResponse =>
    response.type === 'success' && response.data !== null,
  isNoCredential: (response) => response.type === 'noSavedCredentialFound',
  isCancelled: (response) => response.type === 'cancelled',
  errorCode: (error) => (isErrorWithCode(error) ? error.code : null),
};
