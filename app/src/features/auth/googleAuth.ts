import { googleSignIn } from './authApi';
import { nativeGoogleClient, nativeGoogleHelpers } from './googleClient';
import { createGoogleSignInFlow } from './googleSignIn';
import { useSessionStore } from './session';
import { tokenStorage } from './tokenStorage';

export const googleAuth = createGoogleSignInFlow({
  client: nativeGoogleClient,
  helpers: nativeGoogleHelpers,
  api: { googleSignIn },
  storage: tokenStorage,
  store: useSessionStore,
});
