import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { Link, useRouter } from 'expo-router';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { authActions } from '../features/auth/authActions';
import { resetPassword } from '../features/auth/authApi';
import { ApiFailure, mapError } from '../features/auth/errors';
import { MAX_PASSWORD_LENGTH, isValidPassword } from '../features/auth/validation';
import { clearPendingLink, readPendingLink } from '../features/links/pendingLinkStore';
import { useTheme } from '../theme/useTheme';

export function ResetPasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const token = readPendingLink('reset');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!token) return;
    setFormError(null);

    if (!isValidPassword(password)) {
      setFieldError('Password must be between 10 and 128 characters.');
      return;
    }
    if (password !== confirm) {
      setFieldError('Passwords do not match.');
      return;
    }
    setFieldError(null);
    setBusy(true);

    try {
      await resetPassword(token, password);
      clearPendingLink();
      await authActions.logoutAll();
      Alert.alert(
        'Password updated',
        'You have been logged out everywhere. Log in again with your new password.',
        [{ text: 'OK', onPress: () => router.replace('/login') }],
      );
    } catch (error) {
      const friendly = mapError(error, 'reset');
      setFormError(friendly.message);
      if (error instanceof ApiFailure && [400, 401, 403].includes(error.status)) {
        clearPendingLink();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Screen>
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="heading">Reset link unavailable</Text>
            <Text color={theme.colors.textMuted}>This link is invalid or has expired.</Text>
            <Link
              href="/forgot"
              accessibilityRole="link"
              accessibilityLabel="Ask for a new reset link"
              style={{
                color: theme.colors.primary,
                fontSize: theme.typeScale.label.fontSize,
                lineHeight: theme.typeScale.label.lineHeight,
              }}
            >
              Ask for a new reset link
            </Link>
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <View style={{ gap: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="title">Choose a new password</Text>
            <Text color={theme.colors.textMuted}>
              Use 10 to 128 characters. You will be logged out everywhere.
            </Text>
          </View>

          <Input
            label="New password"
            value={password}
            onChangeText={setPassword}
            error={fieldError ?? undefined}
            secureToggle
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            maxLength={MAX_PASSWORD_LENGTH}
          />
          <Input
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            secureToggle
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            maxLength={MAX_PASSWORD_LENGTH}
          />

          {formError ? (
            <Text color={theme.colors.error} accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}

          <Button
            label="Set new password"
            onPress={() => void handleSubmit()}
            loading={busy}
            disabled={busy}
            accessibilityLabel="Set new password"
          />
        </View>
      </Card>
    </Screen>
  );
}
