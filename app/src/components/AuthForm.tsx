import React, { useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { Link } from 'expo-router';

import type { FriendlyErrorKind } from '../features/auth/errors';
import { mapError } from '../features/auth/errors';
import { getGoogleWebClientId } from '../features/auth/googleConfig';
import { googleAuth } from '../features/auth/googleAuth';
import { GoogleCancelledError } from '../features/auth/googleSignIn';
import {
  isValidEmail,
  isValidPassword,
  MAX_PASSWORD_LENGTH,
  normalizeEmail,
} from '../features/auth/validation';

import { Button } from './Button';
import { Card } from './Card';
import { Input } from './Input';
import { Text } from './Text';
import { useTheme } from '../theme/useTheme';

type Props = {
  mode: 'login' | 'signup';
  onSubmit: (email: string, password: string) => Promise<void>;
  switchPrompt: string;
  switchLabel: string;
  switchHref: '/login' | '/signup';
  onAuthenticated?: () => void;
};

type FieldErrors = {
  email?: string;
  password?: string;
};

type FormError = {
  kind: FriendlyErrorKind;
  message: string;
};

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};

  if (!isValidEmail(email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (!isValidPassword(password)) {
    errors.password = 'Password must be between 10 and 128 characters.';
  }

  return errors;
}

export function AuthForm({
  mode,
  onSubmit,
  switchPrompt,
  switchLabel,
  switchHref,
  onAuthenticated,
}: Props) {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<FormError>();
  const [busy, setBusy] = useState(false);

  const isSignup = mode === 'signup';
  const showGoogle = getGoogleWebClientId() !== null;
  const title = isSignup ? 'Create your account' : 'Welcome back';
  const actionLabel = isSignup ? 'Sign up' : 'Log in';
  const actionAccessibilityLabel = isSignup ? 'Create account' : 'Log in';

  async function handleSubmit() {
    const problems = validate(email, password);
    setFieldErrors(problems);
    setFormError(undefined);

    if (problems.email || problems.password) {
      return;
    }

    setBusy(true);
    try {
      await onSubmit(normalizeEmail(email), password);
      onAuthenticated?.();
    } catch (error) {
      setFormError(mapError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setFormError(undefined);
    setBusy(true);
    try {
      await googleAuth.signIn();
      onAuthenticated?.();
    } catch (error) {
      if (!(error instanceof GoogleCancelledError)) {
        setFormError(mapError(error, 'google'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: theme.layout.fill, backgroundColor: theme.colors.background }}
    >
      <View
        style={{
          flex: theme.layout.fill,
          justifyContent: 'center',
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.xl,
        }}
      >
        <Card>
          <View style={{ gap: theme.spacing.lg }}>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="title">{title}</Text>
              <Text color={theme.colors.textMuted}>
                {isSignup ? 'Start managing your team schedule.' : 'Log in to see your shifts.'}
              </Text>
            </View>

            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              error={fieldErrors.email}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="username"
              maxLength={320}
              returnKeyType="next"
            />

            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              error={fieldErrors.password}
              secureToggle
              autoCapitalize="none"
              autoComplete={isSignup ? 'new-password' : 'password'}
              textContentType={isSignup ? 'newPassword' : 'password'}
              maxLength={MAX_PASSWORD_LENGTH}
              returnKeyType="done"
              onSubmitEditing={() => void handleSubmit()}
            />

            {formError ? (
              <Text variant="body" color={theme.colors.error} accessibilityLiveRegion="polite">
                {formError.message}
              </Text>
            ) : null}

            <Button
              label={actionLabel}
              onPress={() => void handleSubmit()}
              loading={busy}
              disabled={busy}
              accessibilityLabel={actionAccessibilityLabel}
            />

            {showGoogle ? (
              <Button
                label="Continue with Google"
                variant="secondary"
                onPress={() => void handleGoogle()}
                loading={busy}
                disabled={busy}
                accessibilityLabel="Continue with Google"
              />
            ) : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              <Text color={theme.colors.textMuted}>{switchPrompt}</Text>
              <Link
                href={switchHref}
                accessibilityRole="link"
                accessibilityLabel={switchLabel}
                style={{
                  color: theme.colors.primary,
                  fontSize: theme.typeScale.label.fontSize,
                  lineHeight: theme.typeScale.label.lineHeight,
                }}
              >
                {switchLabel}
              </Link>
            </View>

            {!isSignup ? (
              <Link
                href="/forgot"
                accessibilityRole="link"
                accessibilityLabel="Forgot password"
                style={{
                  color: theme.colors.primary,
                  fontSize: theme.typeScale.label.fontSize,
                  lineHeight: theme.typeScale.label.lineHeight,
                }}
              >
                Forgot password?
              </Link>
            ) : null}
          </View>
        </Card>
      </View>
    </KeyboardAvoidingView>
  );
}
