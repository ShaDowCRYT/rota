import React, { useState } from 'react';
import { View } from 'react-native';
import { Link } from 'expo-router';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { forgotPassword } from '../features/auth/authApi';
import { mapError } from '../features/auth/errors';
import { isValidEmail, normalizeEmail } from '../features/auth/validation';
import { useTheme } from '../theme/useTheme';

const SUCCESS_MESSAGE = 'If that email exists, a reset link has been sent.';

export default function ForgotPasswordRoute() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setFormError(null);
    if (!isValidEmail(email)) {
      setFieldError('Enter a valid email address.');
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      await forgotPassword(normalizeEmail(email));
      setSent(true);
    } catch (error) {
      setFormError(mapError(error, 'reset').message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card>
        <View style={{ gap: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="title">Reset your password</Text>
            <Text color={theme.colors.textMuted}>
              Enter your email. We will send a reset link if an account exists.
            </Text>
          </View>

          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            error={fieldError ?? undefined}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="username"
            maxLength={320}
          />

          {formError ? (
            <Text color={theme.colors.error} accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}

          {sent ? (
            <Text color={theme.colors.success} accessibilityLiveRegion="polite">
              {SUCCESS_MESSAGE}
            </Text>
          ) : null}

          <Button
            label="Send reset link"
            onPress={() => void handleSubmit()}
            loading={busy}
            disabled={busy}
            accessibilityLabel="Send reset link"
          />

          <Link
            href="/login"
            accessibilityRole="link"
            accessibilityLabel="Back to log in"
            style={{
              color: theme.colors.primary,
              fontSize: theme.typeScale.label.fontSize,
              lineHeight: theme.typeScale.label.lineHeight,
            }}
          >
            Back to log in
          </Link>
        </View>
      </Card>
    </Screen>
  );
}
