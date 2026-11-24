import React from 'react';
import { useRouter } from 'expo-router';

import { AuthForm } from '../components/AuthForm';
import { authActions } from '../features/auth/authActions';
import { readPendingLink } from '../features/links/pendingLinkStore';

export default function SignupScreen() {
  const router = useRouter();

  function afterAuthentication() {
    if (readPendingLink('invite')) {
      router.replace('/invite');
    }
  }

  return (
    <AuthForm
      mode="signup"
      onSubmit={authActions.signUp}
      switchPrompt="Already have an account?"
      switchLabel="Log in"
      switchHref="/login"
      onAuthenticated={afterAuthentication}
    />
  );
}
