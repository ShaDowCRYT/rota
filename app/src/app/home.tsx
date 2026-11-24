import React from 'react';
import { Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { RoleBadge } from '../features/teams/RoleBadge';
import { Screen } from '../components/Screen';
import { StateView } from '../components/StateView';
import { Text } from '../components/Text';
import { mapError } from '../features/auth/errors';
import { useSessionStore } from '../features/auth/session';
import { listTeams } from '../features/teams/teamsApi';
import { useTheme } from '../theme/useTheme';

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const user = useSessionStore((state) => state.user);
  const { data, error, isPending, isRefetching, refetch } = useQuery({
    queryKey: ['teams'],
    queryFn: () => listTeams(),
  });

  const teams = data ?? [];
  const errorMessage = error ? mapError(error, 'team').message : undefined;

  return (
    <Screen refreshing={isRefetching && !isPending} onRefresh={() => void refetch()}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">Your teams</Text>
        <Text
          variant="body"
          color={theme.colors.textMuted}
          accessibilityLabel={`Signed in as ${user?.email ?? 'unknown user'}`}
        >
          {user?.email ?? 'Signed in'}
        </Text>
      </View>

      <Button
        label="Create team"
        onPress={() => router.push('/create-team')}
        accessibilityLabel="Create team"
      />

      {isPending ? <StateView loading /> : null}

      {!isPending && errorMessage ? (
        <StateView errorMessage={errorMessage} onRetry={() => void refetch()} />
      ) : null}

      {!isPending && !errorMessage && teams.length === 0 ? (
        <StateView emptyMessage="You are not in a team yet. Create one or open an invite link." />
      ) : null}

      {!isPending && !errorMessage
        ? teams.map((team) => (
            <Pressable
              key={team.id}
              onPress={() =>
                router.push({ pathname: '/team/[teamId]', params: { teamId: team.id } })
              }
              accessibilityRole="button"
              accessibilityLabel={`Open ${team.name}`}
            >
              <Card>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: theme.spacing.sm,
                  }}
                >
                  <Text variant="heading" style={{ flex: theme.layout.fill }}>
                    {team.name}
                  </Text>
                  <RoleBadge role={team.role} />
                </View>
              </Card>
            </Pressable>
          ))
        : null}

      <Button
        label="Account and server status"
        variant="secondary"
        onPress={() => router.push('/account')}
        accessibilityLabel="Open account and server status"
      />
    </Screen>
  );
}
