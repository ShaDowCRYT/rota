import React, { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '../../../../components/Button';
import { Card } from '../../../../components/Card';
import { Screen } from '../../../../components/Screen';
import { StateView } from '../../../../components/StateView';
import { Text } from '../../../../components/Text';
import { mapError } from '../../../../features/auth/errors';
import { useSessionStore } from '../../../../features/auth/session';
import { ConfirmPanel } from '../../../../features/swaps/ConfirmPanel';
import {
  approveSwap,
  cancelSwap,
  listSwaps,
  rejectSwap,
  SWAP_GC_TIME,
  SWAP_STALE_TIME,
  type SwapRequestView,
} from '../../../../features/swaps/swapsApi';
import {
  getMembers,
  MEMBER_GC_TIME,
  MEMBER_STALE_TIME,
} from '../../../../features/teams/teamsApi';
import { useTeamId } from '../../../../features/teams/useTeamId';
import { useTeamRole } from '../../../../features/teams/useTeamRole';
import { useTheme } from '../../../../theme/useTheme';

export default function SwapsTab() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const teamId = useTeamId();
  const userId = useSessionStore((state) => state.user?.id);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);
  const [chooseAssigneeId, setChooseAssigneeId] = useState<string | null>(null);

  const swapsQuery = useQuery({
    queryKey: ['team', teamId, 'swaps'],
    queryFn: () => listSwaps(teamId, undefined),
    staleTime: SWAP_STALE_TIME,
    gcTime: SWAP_GC_TIME,
  });
  const membersQuery = useQuery({
    queryKey: ['team', teamId, 'members'],
    queryFn: () => getMembers(teamId),
    staleTime: MEMBER_STALE_TIME,
    gcTime: MEMBER_GC_TIME,
  });
  const roleQuery = useTeamRole(teamId);

  const cancel = useMutation({ mutationFn: (requestId: string) => cancelSwap(teamId, requestId) });
  const approve = useMutation({
    mutationFn: ({ requestId, assigneeId }: { requestId: string; assigneeId?: string }) =>
      approveSwap(teamId, requestId, assigneeId),
  });
  const reject = useMutation({
    mutationFn: (requestId: string) => rejectSwap(teamId, requestId),
  });

  const busy = cancel.isPending || approve.isPending || reject.isPending;

  async function refresh() {
    await Promise.all([
      swapsQuery.refetch(),
      membersQuery.refetch(),
      roleQuery.query.refetch(),
    ]);
  }

  async function invalidateTeamData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['team', teamId, 'swaps'] }),
      queryClient.invalidateQueries({ queryKey: ['team', teamId, 'shifts'] }),
      queryClient.invalidateQueries({ queryKey: ['team', teamId, 'activity'] }),
    ]);
  }

  function handleFailure(error: unknown) {
    setActionError(mapError(error, 'swap').message);
    setConfirmCancelId(null);
    setConfirmRejectId(null);
    setConfirmApproveId(null);
    setChooseAssigneeId(null);
  }

  async function handleCancel(requestId: string) {
    setActionError(null);
    try {
      await cancel.mutateAsync(requestId);
      setConfirmCancelId(null);
      await invalidateTeamData();
    } catch (error) {
      handleFailure(error);
    }
  }

  async function handleApprove(requestId: string, assigneeId?: string) {
    setActionError(null);
    try {
      await approve.mutateAsync({ requestId, assigneeId });
      setConfirmApproveId(null);
      setChooseAssigneeId(null);
      await invalidateTeamData();
    } catch (error) {
      handleFailure(error);
    }
  }

  async function handleReject(requestId: string) {
    setActionError(null);
    try {
      await reject.mutateAsync(requestId);
      setConfirmRejectId(null);
      await invalidateTeamData();
    } catch (error) {
      handleFailure(error);
    }
  }

  if (swapsQuery.isPending || membersQuery.isPending || roleQuery.query.isPending) {
    return (
      <Screen>
        <StateView loading />
      </Screen>
    );
  }

  const error = swapsQuery.error ?? membersQuery.error ?? roleQuery.query.error;
  if (error) {
    return (
      <Screen>
        <StateView errorMessage={mapError(error, 'team').message} onRetry={() => void refresh()} />
      </Screen>
    );
  }

  const emailById = new Map((membersQuery.data ?? []).map((member) => [member.id, member.email] as const));
  const emailFor = (id: string): string => emailById.get(id) ?? 'Team member';
  const swaps: SwapRequestView[] = swapsQuery.data ?? [];
  const myRequests = swaps.filter((swap) => swap.requesterId === userId);
  const teamRequests = roleQuery.canManageShifts
    ? swaps.filter((swap) => swap.status === 'pending')
    : [];
  const empty = myRequests.length === 0 && teamRequests.length === 0;

  function requestRow(swap: SwapRequestView, showTeamActions: boolean) {
    return (
      <View key={swap.id} style={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }}>
        <Text variant="label">Status: {swap.status}</Text>
        <Text variant="caption" color={theme.colors.textMuted}>
          From {emailFor(swap.requesterId)} to{' '}
          {swap.targetId ? emailFor(swap.targetId) : 'the team'}
        </Text>

        {!showTeamActions && swap.status === 'pending' && swap.requesterId === userId ? (
          <Button
            label="Cancel request"
            variant="secondary"
            onPress={() => setConfirmCancelId(swap.id)}
            disabled={busy}
            accessibilityLabel={`Cancel swap request from ${emailFor(swap.requesterId)}`}
          />
        ) : null}

        {confirmCancelId === swap.id ? (
          <ConfirmPanel
            message="Cancel this swap request?"
            confirmLabel="Yes, cancel"
            onConfirm={() => void handleCancel(swap.id)}
            onCancel={() => setConfirmCancelId(null)}
            busy={busy}
            loading={cancel.isPending}
          />
        ) : null}

        {showTeamActions ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            <Button
              label="Approve"
              onPress={() => {
                setChooseAssigneeId(swap.targetId ? null : swap.id);
                setConfirmApproveId(swap.targetId ? swap.id : null);
              }}
              disabled={busy}
              accessibilityLabel={`Approve swap request from ${emailFor(swap.requesterId)}`}
            />
            <Button
              label="Reject"
              variant="secondary"
              onPress={() => setConfirmRejectId(swap.id)}
              disabled={busy}
              accessibilityLabel={`Reject swap request from ${emailFor(swap.requesterId)}`}
            />
          </View>
        ) : null}

        {chooseAssigneeId === swap.id ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label">Who takes the shift?</Text>
            {membersQuery.data
              ?.filter((member) => member.id !== swap.requesterId)
              .map((member) => (
                <Button
                  key={member.id}
                  label={member.email}
                  variant="secondary"
                  onPress={() => void handleApprove(swap.id, member.id)}
                  disabled={busy}
                  accessibilityLabel={`Assign the shift to ${member.email}`}
                />
              ))}
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setChooseAssigneeId(null)}
              disabled={busy}
              accessibilityLabel="Cancel choosing assignee"
            />
          </View>
        ) : null}

        {confirmApproveId === swap.id ? (
          <ConfirmPanel
            message="Approve this swap and change the shift assignee?"
            confirmLabel="Yes, approve"
            onConfirm={() => void handleApprove(swap.id)}
            onCancel={() => setConfirmApproveId(null)}
            busy={busy}
            loading={approve.isPending}
          />
        ) : null}

        {confirmRejectId === swap.id ? (
          <ConfirmPanel
            message="Reject this swap request?"
            confirmLabel="Yes, reject"
            onConfirm={() => void handleReject(swap.id)}
            onCancel={() => setConfirmRejectId(null)}
            busy={busy}
            loading={reject.isPending}
          />
        ) : null}
      </View>
    );
  }

  return (
    <Screen
      refreshing={
        swapsQuery.isRefetching || membersQuery.isRefetching || roleQuery.query.isRefetching
      }
      onRefresh={() => void refresh()}
    >
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="title">Swaps</Text>
          {actionError ? (
            <Text color={theme.colors.error} accessibilityLiveRegion="polite">
              {actionError}
            </Text>
          ) : null}
        </View>
      </Card>

      {empty ? <StateView emptyMessage="No swap requests yet." /> : null}

      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">My requests</Text>
          {myRequests.map((swap) => requestRow(swap, false))}
        </View>
      </Card>

      {roleQuery.canManageShifts ? (
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">Team requests</Text>
            {teamRequests.map((swap) => requestRow(swap, true))}
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
