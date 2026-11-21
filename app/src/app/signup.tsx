import React from 'react';

import { AuthForm } from '../components/AuthForm';
import { authActions } from '../features/auth/authActions';

export default function SignupScreen() {
  return (
    <AuthForm
      mode="signup"
      onSubmit={authActions.signUp}
      switchPrompt="Already have an account?"
      switchLabel="Log in"
      switchHref="/login"
    />
  );
}
