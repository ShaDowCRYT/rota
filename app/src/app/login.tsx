import React from 'react';
import { useRouter } from 'expo-router';

import { AuthForm } from '../components/AuthForm';
import { authActions } from '../features/auth/authActions';
import { readPendingLink } from '../features/links/pendingLinkStore';

export default function LoginScreen() {
  const router = useRouter();

  function afterAuthentication() {
    if (readPendingLink('invite')) {
      router.replace('/invite');
    }
  }

  return (
    <AuthForm
      mode="login"
      onSubmit={authActions.signIn}
      switchPrompt="New to Rota?"
      switchLabel="Sign up"
      switchHref="/signup"
      onAuthenticated={afterAuthentication}
    />
  );
}
