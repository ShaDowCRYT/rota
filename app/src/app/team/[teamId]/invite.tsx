import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { Text } from '../../../components/Text';
import { mapError } from '../../../features/auth/errors';
import { InvitesPanel } from '../../../features/teams/InvitesPanel';
import { useTeamId } from '../../../features/teams/useTeamId';
import { useTeamRole } from '../../../features/teams/useTeamRole';
import { useTheme } from '../../../theme/useTheme';

export default function TeamInviteRoute() {
  const theme = useTheme();
  const router = useRouter();
  const teamId = useTeamId();

  const roleQuery = useTeamRole(teamId);

  if (roleQuery.query.isPending) {
    return (
      <Screen>
        <StateView loading />
      </Screen>
    );
  }

  if (roleQuery.query.error) {
    return (
      <Screen>
        <StateView
          errorMessage={mapError(roleQuery.query.error, 'team').message}
          onRetry={() => void roleQuery.query.refetch()}
        />
      </Screen>
    );
  }

  if (!roleQuery.isOwner) {
    return (
      <Screen>
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="heading">Invites unavailable</Text>
            <Text color={theme.colors.textMuted}>You don&apos;t have permission to do that</Text>
            <Button
              label="Back to team"
              variant="secondary"
              onPress={() => router.back()}
              accessibilityLabel="Back to team"
            />
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <InvitesPanel teamId={teamId} isOwner />
    </Screen>
  );
}
