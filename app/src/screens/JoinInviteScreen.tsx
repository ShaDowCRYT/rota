import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { INVALID_INVITE_LINK_MESSAGE, parseInviteInput } from '../features/links/deepLinks';
import { setPendingLink } from '../features/links/pendingLinkStore';
import { useTheme } from '../theme/useTheme';

export function JoinInviteScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [inviteInput, setInviteInput] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  function handleContinue() {
    const token = parseInviteInput(inviteInput);
    if (!token) {
      setFieldError(INVALID_INVITE_LINK_MESSAGE);
      return;
    }

    setFieldError(null);
    setPendingLink('invite', token);
    setInviteInput('');
    router.replace('/accept-invite');
  }

  return (
    <Screen>
      <Card>
        <View style={{ gap: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="heading">Join a team</Text>
            <Text color={theme.colors.textMuted}>
              Paste the invite link or token you were sent.
            </Text>
          </View>

          <Input
            label="Invite link or token"
            value={inviteInput}
            onChangeText={setInviteInput}
            error={fieldError ?? undefined}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          <Button
            label="Continue"
            onPress={handleContinue}
            accessibilityLabel="Continue with invite link"
          />
        </View>
      </Card>
    </Screen>
  );
}
