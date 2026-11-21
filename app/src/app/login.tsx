import React from 'react';

import { AuthForm } from '../components/AuthForm';
import { authActions } from '../features/auth/authActions';

export default function LoginScreen() {
  return (
    <AuthForm
      mode="login"
      onSubmit={authActions.signIn}
      switchPrompt="New to Rota?"
      switchLabel="Sign up"
      switchHref="/signup"
    />
  );
}
