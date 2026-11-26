import React from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { TeamIdProvider } from '../../../features/teams/TeamIdProvider';
import { createTeamIdContextValue } from '../../../features/teams/teamIdContext';
import { useTheme } from '../../../theme/useTheme';

export default function TeamDetailLayout() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const value = createTeamIdContextValue(params.teamId);

  if (!value.teamId) {
    return (
      <Screen>
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="heading">Team not found</Text>
            <Text variant="body" color={theme.colors.textMuted}>
              This team link is not valid. Go back and choose a team again.
            </Text>
            <Button
              label="Back"
              onPress={() => router.back()}
              accessibilityLabel="Go back"
            />
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <TeamIdProvider value={value}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="invite" />
        <Stack.Screen name="shift/[shiftId]" />
        <Stack.Screen name="shifts/new" />
        <Stack.Screen name="shifts/[shiftId]/edit" />
        <Stack.Screen name="shifts/[shiftId]/swap" />
      </Stack>
    </TeamIdProvider>
  );
}
