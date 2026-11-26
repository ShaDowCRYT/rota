import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button } from '../../../../components/Button';
import { Card } from '../../../../components/Card';
import { Screen } from '../../../../components/Screen';
import { StateView } from '../../../../components/StateView';
import { Text } from '../../../../components/Text';
import { mapError } from '../../../../features/auth/errors';
import { useSessionStore } from '../../../../features/auth/session';
import { isFutureShift, formatLocalDateTime } from '../../../../features/schedule/dateTime';
import { getWeekRange } from '../../../../features/schedule/week';
import {
  deleteShift,
  listShifts,
  SHIFT_GC_TIME,
  SHIFT_STALE_TIME,
} from '../../../../features/shifts/shiftsApi';
import { pendingSwapForShift } from '../../../../features/swaps/optimistic';
import { useSwapNoticeStore } from '../../../../features/swaps/swapNoticeStore';
import { listSwaps, SWAP_GC_TIME, SWAP_STALE_TIME } from '../../../../features/swaps/swapsApi';
import {
  getMembers,
  MEMBER_GC_TIME,
  MEMBER_STALE_TIME,
} from '../../../../features/teams/teamsApi';
import { useTeamId } from '../../../../features/teams/useTeamId';
import { useTeamRole } from '../../../../features/teams/useTeamRole';
import { useTheme } from '../../../../theme/useTheme';

export default function ShiftDetailRoute() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    teamId: string;
    shiftId: string;
    startsAt: string;
  }>();
  const teamId = useTeamId();
  const shiftId = params.shiftId;
  const userId = useSessionStore((state) => state.user?.id);
  const [nowIso] = useState(() => new Date().toISOString());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );
  const week = useMemo(
    () => getWeekRange(params.startsAt || nowIso, timeZone),
    [params.startsAt, nowIso, timeZone],
  );

  const shiftQuery = useQuery({
    queryKey: ['team', teamId, 'shifts', week.start, week.end],
    queryFn: () => listShifts(teamId, week.start, week.end),
    staleTime: SHIFT_STALE_TIME,
    gcTime: SHIFT_GC_TIME,
    enabled: Boolean(params.startsAt),
  });
  const membersQuery = useQuery({
    queryKey: ['team', teamId, 'members'],
    queryFn: () => getMembers(teamId),
    staleTime: MEMBER_STALE_TIME,
    gcTime: MEMBER_GC_TIME,
  });
  const swapsQuery = useQuery({
    queryKey: ['team', teamId, 'swaps'],
    queryFn: () => listSwapsForDetail(teamId),
    staleTime: SWAP_STALE_TIME,
    gcTime: SWAP_GC_TIME,
  });
  const roleQuery = useTeamRole(teamId);

  const remove = useMutation({ mutationFn: () => deleteShift(teamId, shiftId) });

  const notice = useSwapNoticeStore((state) => state.message);
  const clearNotice = useSwapNoticeStore((state) => state.clearMessage);

  const shift = shiftQuery.data?.find((item) => item.id === shiftId);
  const loading =
    shiftQuery.isPending || membersQuery.isPending || swapsQuery.isPending || roleQuery.query.isPending;
  const error =
    shiftQuery.error ?? membersQuery.error ?? swapsQuery.error ?? roleQuery.query.error;
  const refreshing =
    shiftQuery.isRefetching ||
    membersQuery.isRefetching ||
    swapsQuery.isRefetching ||
    roleQuery.query.isRefetching;

  async function refresh() {
    await Promise.all([
      shiftQuery.refetch(),
      membersQuery.refetch(),
      swapsQuery.refetch(),
      roleQuery.query.refetch(),
    ]);
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await remove.mutateAsync();
      setConfirmDelete(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['team', teamId, 'shifts'] }),
        queryClient.invalidateQueries({ queryKey: ['team', teamId, 'activity'] }),
        queryClient.invalidateQueries({ queryKey: ['team', teamId, 'swaps'] }),
      ]);
      router.back();
    } catch (deleteError) {
      setActionError(mapError(deleteError, 'shift').message);
      setConfirmDelete(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <StateView loading />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <StateView errorMessage={mapError(error, 'shift').message} onRetry={() => void refresh()} />
      </Screen>
    );
  }

  if (!shift) {
    return (
      <Screen>
        <StateView emptyMessage="This shift is no longer available." />
      </Screen>
    );
  }

  const assigneeEmail =
    membersQuery.data?.find((member) => member.id === shift.assigneeId)?.email ?? 'Team member';
  const isMyShift = shift.assigneeId === userId;
  const canRequestSwap = isMyShift && isFutureShift(shift.startsAt, nowIso);
  const pending = pendingSwapForShift(swapsQuery.data, shift.id);

  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="title">Shift details</Text>
          <Text variant="heading">{assigneeEmail}</Text>
          <Text variant="body">
            {formatLocalDateTime(shift.startsAt, timeZone)} to{' '}
            {formatLocalDateTime(shift.endsAt, timeZone)}
          </Text>
          {isMyShift ? (
            <Text variant="label" color={theme.colors.primary}>
              My shift
            </Text>
          ) : null}
          {pending ? (
            <Text variant="label" color={theme.colors.warning}>
              Swap requested
            </Text>
          ) : null}
        </View>
      </Card>

      {notice ? (
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text color={theme.colors.error} accessibilityLiveRegion="polite">
              {notice}
            </Text>
            <Button
              label="Dismiss"
              variant="secondary"
              onPress={clearNotice}
              accessibilityLabel="Dismiss message"
            />
          </View>
        </Card>
      ) : null}

      {actionError ? (
        <Text color={theme.colors.error} accessibilityLiveRegion="polite">
          {actionError}
        </Text>
      ) : null}

      {roleQuery.canManageShifts ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          <Button
            label="Edit shift"
            onPress={() =>
              router.push({
                pathname: '/team/[teamId]/shifts/[shiftId]/edit',
                params: {
                  teamId,
                  shiftId: shift.id,
                  assigneeId: shift.assigneeId,
                  startsAt: shift.startsAt,
                  endsAt: shift.endsAt,
                },
              })
            }
            accessibilityLabel="Edit shift"
          />
          <Button
            label="Delete shift"
            variant="secondary"
            onPress={() => setConfirmDelete(true)}
            disabled={remove.isPending}
            accessibilityLabel="Delete shift"
          />
        </View>
      ) : null}

      {canRequestSwap && !pending ? (
        <Button
          label="Request swap"
          onPress={() =>
            router.push({
              pathname: '/team/[teamId]/shifts/[shiftId]/swap',
              params: {
                teamId,
                shiftId: shift.id,
                startsAt: shift.startsAt,
                endsAt: shift.endsAt,
              },
            })
          }
          accessibilityLabel="Request swap"
        />
      ) : null}

      {confirmDelete ? (
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text color={theme.colors.warning}>
              Delete this shift? Everyone on the team will see it removed.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              <Button
                label="Yes, delete"
                onPress={() => void handleDelete()}
                loading={remove.isPending}
                accessibilityLabel="Confirm delete shift"
              />
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setConfirmDelete(false)}
                disabled={remove.isPending}
                accessibilityLabel="Cancel delete shift"
              />
            </View>
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

function listSwapsForDetail(teamId: string) {
  return listSwaps(teamId, undefined);
}
