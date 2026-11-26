import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button } from '../../../../../components/Button';
import { Card } from '../../../../../components/Card';
import { Screen } from '../../../../../components/Screen';
import { Text } from '../../../../../components/Text';
import { ShiftEditor } from '../../../../../features/shifts/ShiftEditor';
import { useTeamId } from '../../../../../features/teams/useTeamId';
import { useTheme } from '../../../../../theme/useTheme';

export default function EditShiftRoute() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    teamId: string;
    shiftId: string;
    assigneeId: string;
    startsAt: string;
    endsAt: string;
  }>();
  const teamId = useTeamId();

  if (!params.assigneeId || !params.startsAt || !params.endsAt) {
    return (
      <Screen>
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="heading">Shift unavailable</Text>
            <Text color={theme.colors.textMuted}>
              This shift could not be opened. Go back and try again.
            </Text>
            <Button
              label="Back to shift"
              onPress={() => router.back()}
              accessibilityLabel="Back to shift"
            />
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <ShiftEditor
      teamId={teamId}
      shiftId={params.shiftId}
      initial={{
        id: params.shiftId,
        assigneeId: params.assigneeId,
        startsAt: params.startsAt,
        endsAt: params.endsAt,
      }}
    />
  );
}
