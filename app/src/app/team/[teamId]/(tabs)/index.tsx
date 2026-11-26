import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { Button } from '../../../../components/Button';
import { Card } from '../../../../components/Card';
import { Screen } from '../../../../components/Screen';
import { StateView } from '../../../../components/StateView';
import { Text } from '../../../../components/Text';
import { useSessionStore } from '../../../../features/auth/session';
import { mapError } from '../../../../features/auth/errors';
import {
  formatShiftWindow,
  formatWeekRange,
  getWeekRange,
  groupShiftsByDay,
  shiftWeek,
} from '../../../../features/schedule/week';
import {
  listShifts,
  SHIFT_GC_TIME,
  SHIFT_STALE_TIME,
} from '../../../../features/shifts/shiftsApi';
import { swapLabelForShift } from '../../../../features/swaps/optimistic';
import {
  listSwaps,
  SWAP_GC_TIME,
  SWAP_STALE_TIME,
} from '../../../../features/swaps/swapsApi';
import {
  getMembers,
  MEMBER_GC_TIME,
  MEMBER_STALE_TIME,
} from '../../../../features/teams/teamsApi';
import { useTeamId } from '../../../../features/teams/useTeamId';
import { useTeamRole } from '../../../../features/teams/useTeamRole';
import { useTheme } from '../../../../theme/useTheme';

export default function ScheduleTab() {
  const theme = useTheme();
  const router = useRouter();
  const teamId = useTeamId();
  const userId = useSessionStore((state) => state.user?.id);
  const [anchorIso, setAnchorIso] = useState(() => new Date().toISOString());
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );
  const week = useMemo(() => getWeekRange(anchorIso, timeZone), [anchorIso, timeZone]);

  const shiftsQuery = useQuery({
    queryKey: ['team', teamId, 'shifts', week.start, week.end],
    queryFn: () => listShifts(teamId, week.start, week.end),
    staleTime: SHIFT_STALE_TIME,
    gcTime: SHIFT_GC_TIME,
  });
  const membersQuery = useQuery({
    queryKey: ['team', teamId, 'members'],
    queryFn: () => getMembers(teamId),
    staleTime: MEMBER_STALE_TIME,
    gcTime: MEMBER_GC_TIME,
  });
  const swapsQuery = useQuery({
    queryKey: ['team', teamId, 'swaps'],
    queryFn: () => listSwaps(teamId, undefined),
    staleTime: SWAP_STALE_TIME,
    gcTime: SWAP_GC_TIME,
  });
  const roleQuery = useTeamRole(teamId);

  const groups = useMemo(
    () => groupShiftsByDay(shiftsQuery.data ?? [], timeZone),
    [shiftsQuery.data, timeZone],
  );
  const emailById = useMemo(() => {
    const entries = (membersQuery.data ?? []).map((member) => [member.id, member.email] as const);
    return new Map(entries);
  }, [membersQuery.data]);

  const loading =
    shiftsQuery.isPending || membersQuery.isPending || swapsQuery.isPending || roleQuery.query.isPending;
  const error =
    shiftsQuery.error ?? membersQuery.error ?? swapsQuery.error ?? roleQuery.query.error;
  const refreshing =
    shiftsQuery.isRefetching ||
    membersQuery.isRefetching ||
    swapsQuery.isRefetching ||
    roleQuery.query.isRefetching;

  async function refresh() {
    await Promise.all([
      shiftsQuery.refetch(),
      membersQuery.refetch(),
      swapsQuery.refetch(),
      roleQuery.query.refetch(),
    ]);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">Schedule</Text>
          <Text variant="body" color={theme.colors.textMuted} accessibilityLabel={`Week of ${formatWeekRange(week, timeZone)}`}>
            {formatWeekRange(week, timeZone)}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            <Button
              label="Previous week"
              variant="secondary"
              onPress={() => setAnchorIso(shiftWeek(week, timeZone, -1).start)}
              accessibilityLabel="Show previous week"
            />
            <Button
              label="Next week"
              variant="secondary"
              onPress={() => setAnchorIso(shiftWeek(week, timeZone, 1).start)}
              accessibilityLabel="Show next week"
            />
            {roleQuery.canManageShifts ? (
              <Button
                label="Create shift"
                onPress={() =>
                  router.push({
                    pathname: '/team/[teamId]/shifts/new',
                    params: { teamId },
                  })
                }
                accessibilityLabel="Create shift"
              />
            ) : null}
          </View>
        </View>
      </Card>

      {loading ? <StateView loading /> : null}

      {error && !loading ? (
        <StateView
          errorMessage={mapError(error, 'team').message}
          onRetry={() => void refresh()}
        />
      ) : null}

      {!loading && !error && shiftsQuery.data?.length === 0 ? (
        <StateView emptyMessage="No shifts this week" />
      ) : null}

      {groups.map((group) => (
        <Card key={group.dateKey}>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="heading">{group.label}</Text>
            {group.shifts.map((shift) => {
              const isMine = shift.assigneeId === userId;
              const swapLabel = swapLabelForShift(swapsQuery.data, shift.id);
              return (
                <Card
                  key={shift.id}
                  style={{
                    borderColor: isMine ? theme.colors.primary : theme.colors.border,
                  }}
                >
                  <View style={{ gap: theme.spacing.sm }}>
                    <Text variant="label">
                      {emailById.get(shift.assigneeId) ?? 'Team member'}
                    </Text>
                    <Text variant="body">{formatShiftWindow(shift, timeZone)}</Text>
                    {isMine ? (
                      <Text variant="caption" color={theme.colors.primary}>
                        My shift
                      </Text>
                    ) : null}
                    {swapLabel ? (
                      <Text variant="caption" color={theme.colors.warning}>
                        {swapLabel}
                      </Text>
                    ) : null}
                    <Button
                      label="View shift"
                      variant="secondary"
                      onPress={() =>
                        router.push({
                          pathname: '/team/[teamId]/shift/[shiftId]',
                          params: { teamId, shiftId: shift.id, startsAt: shift.startsAt },
                        })
                      }
                      accessibilityLabel={`View shift for ${emailById.get(shift.assigneeId) ?? 'team member'}`}
                    />
                  </View>
                </Card>
              );
            })}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
