import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { StateView } from '../../components/StateView';
import { Text } from '../../components/Text';
import { ApiFailure, mapError } from '../../features/auth/errors';
import { MemberRow } from '../../features/teams/MemberRow';
import {
  changeRole,
  getMembers,
  getTeam,
  listTeams,
  removeMember,
  type InviteRole,
} from '../../features/teams/teamsApi';
import { useTheme } from '../../theme/useTheme';

export default function TeamRoute() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ teamId: string }>();
  const teamId = params.teamId;
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmUserId, setConfirmUserId] = useState<string | null>(null);

  const teamQuery = useQuery({ queryKey: ['team', teamId], queryFn: () => getTeam(teamId) });
  const membersQuery = useQuery({
    queryKey: ['team', teamId, 'members'],
    queryFn: () => getMembers(teamId),
  });
  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: () => listTeams() });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: InviteRole }) =>
      changeRole(teamId, userId, role),
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(teamId, userId),
  });

  const isOwner = teamsQuery.data?.find((team) => team.id === teamId)?.role === 'owner';
  const busy = roleMutation.isPending || removeMutation.isPending;
  const notFound = teamQuery.error instanceof ApiFailure && teamQuery.error.status === 404;

  useEffect(() => {
    if (!notFound) return;
    void queryClient.invalidateQueries({ queryKey: ['teams'] });
    router.replace('/home');
  }, [notFound, queryClient, router]);

  async function refreshAll() {
    await Promise.all([teamQuery.refetch(), membersQuery.refetch(), teamsQuery.refetch()]);
  }

  async function handleRole(userId: string, role: InviteRole) {
    setActionError(null);
    try {
      await roleMutation.mutateAsync({ userId, role });
      await refreshAll();
    } catch (error) {
      setActionError(mapError(error, 'team').message);
      await refreshAll().catch(() => undefined);
    } finally {
      roleMutation.reset();
    }
  }

  async function handleRemove(userId: string) {
    setActionError(null);
    try {
      await removeMutation.mutateAsync(userId);
      setConfirmUserId(null);
      await refreshAll();
    } catch (error) {
      setActionError(mapError(error, 'team').message);
      setConfirmUserId(null);
      await refreshAll().catch(() => undefined);
    } finally {
      removeMutation.reset();
    }
  }

  if (notFound) {
    return (
      <Screen>
        <StateView loading />
      </Screen>
    );
  }

  return (
    <Screen
      refreshing={(teamQuery.isRefetching || membersQuery.isRefetching) && !teamQuery.isPending}
      onRefresh={() => void refreshAll()}
    >
      {teamQuery.isPending || membersQuery.isPending ? <StateView loading /> : null}

      {teamQuery.error && !notFound ? (
        <StateView
          errorMessage={mapError(teamQuery.error, 'team').message}
          onRetry={() => void teamQuery.refetch()}
        />
      ) : null}

      {membersQuery.error && !teamQuery.error ? (
        <StateView
          errorMessage={mapError(membersQuery.error, 'team').message}
          onRetry={() => void membersQuery.refetch()}
        />
      ) : null}

      {teamQuery.data ? (
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="title">{teamQuery.data.name}</Text>
            {isOwner ? (
              <Button
                label="Invite a member"
                onPress={() =>
                  router.push({ pathname: '/team/[teamId]/invite', params: { teamId } })
                }
                accessibilityLabel="Invite a member"
              />
            ) : null}
          </View>
        </Card>
      ) : null}

      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">Members</Text>
          {actionError ? (
            <Text color={theme.colors.error} accessibilityLiveRegion="polite">
              {actionError}
            </Text>
          ) : null}
          {membersQuery.data && membersQuery.data.length === 0 ? (
            <StateView emptyMessage="No members were found." />
          ) : null}
          {membersQuery.data?.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              canManage={isOwner}
              busy={busy}
              onChangeRole={(userId, role) => void handleRole(userId, role)}
              onRemove={(userId) => setConfirmUserId(userId)}
            />
          ))}
          {confirmUserId ? (
            <View
              style={{
                gap: theme.spacing.sm,
                padding: theme.spacing.md,
                borderWidth: theme.sizes.borderWidth,
                borderColor: theme.colors.warning,
                borderRadius: theme.radii.sm,
              }}
            >
              <Text color={theme.colors.warning}>
                Remove this member from the team? They will lose access at once.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                <Button
                  label="Yes, remove"
                  onPress={() => void handleRemove(confirmUserId)}
                  loading={removeMutation.isPending}
                  disabled={busy}
                  accessibilityLabel="Confirm remove member"
                />
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setConfirmUserId(null)}
                  disabled={busy}
                  accessibilityLabel="Cancel remove member"
                />
              </View>
            </View>
          ) : null}
        </View>
      </Card>
    </Screen>
  );
}
