import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { Button } from '../../../../components/Button';
import { Card } from '../../../../components/Card';
import { Screen } from '../../../../components/Screen';
import { StateView } from '../../../../components/StateView';
import { Text } from '../../../../components/Text';
import { ApiFailure, mapError } from '../../../../features/auth/errors';
import { InvitesPanel } from '../../../../features/teams/InvitesPanel';
import { MemberRow } from '../../../../features/teams/MemberRow';
import { canInviteMembers, canManageMember } from '../../../../features/teams/memberPermissions';
import {
  changeRole,
  getMembers,
  getTeam,
  MEMBER_GC_TIME,
  MEMBER_STALE_TIME,
  removeMember,
  type InviteRole,
} from '../../../../features/teams/teamsApi';
import { useTeamId } from '../../../../features/teams/useTeamId';
import { useTeamRole } from '../../../../features/teams/useTeamRole';
import { useTheme } from '../../../../theme/useTheme';

export default function MembersTab() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const teamId = useTeamId();
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmUserId, setConfirmUserId] = useState<string | null>(null);

  const teamQuery = useQuery({ queryKey: ['team', teamId], queryFn: () => getTeam(teamId) });
  const membersQuery = useQuery({
    queryKey: ['team', teamId, 'members'],
    queryFn: () => getMembers(teamId),
    staleTime: MEMBER_STALE_TIME,
    gcTime: MEMBER_GC_TIME,
  });
  const roleQuery = useTeamRole(teamId);

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: InviteRole }) =>
      changeRole(teamId, userId, role),
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(teamId, userId),
  });

  const isOwner = canInviteMembers(roleQuery.role);
  const busy = roleMutation.isPending || removeMutation.isPending;
  const notFound = teamQuery.error instanceof ApiFailure && teamQuery.error.status === 404;

  useEffect(() => {
    if (!notFound) return;
    void queryClient.invalidateQueries({ queryKey: ['teams'] });
    router.replace('/home');
  }, [notFound, queryClient, router]);

  async function refreshAll() {
    await Promise.all([
      teamQuery.refetch(),
      membersQuery.refetch(),
      roleQuery.query.refetch(),
      queryClient.invalidateQueries({ queryKey: ['team', teamId, 'invites'] }),
    ]);
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

  const loading = teamQuery.isPending || membersQuery.isPending || roleQuery.query.isPending;
  const error = teamQuery.error ?? membersQuery.error ?? roleQuery.query.error;
  const refreshing =
    teamQuery.isRefetching || membersQuery.isRefetching || roleQuery.query.isRefetching;

  return (
    <Screen refreshing={refreshing && !loading} onRefresh={() => void refreshAll()}>
      {loading ? <StateView loading /> : null}

      {error && !loading ? (
        <StateView errorMessage={mapError(error, 'team').message} onRetry={() => void refreshAll()} />
      ) : null}

      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="title">{teamQuery.data?.name ?? 'Team'}</Text>
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
              canManage={canManageMember(roleQuery.role, member.role)}
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

      <InvitesPanel teamId={teamId} isOwner={isOwner} />
    </Screen>
  );
}
