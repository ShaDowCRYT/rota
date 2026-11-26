import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { StateView } from '../../components/StateView';
import { Text } from '../../components/Text';
import { mapError } from '../auth/errors';
import { DateTimeFields } from '../schedule/DateTimeFields';
import { combineLocalDateTime, isValidShiftWindow, nextDayChips } from '../schedule/dateTime';
import { formatLocalTime, localDateKey } from '../schedule/week';
import {
  createShift,
  deleteShift,
  updateShift,
  type Shift,
} from './shiftsApi';
import {
  getMembers,
  MEMBER_GC_TIME,
  MEMBER_STALE_TIME,
} from '../teams/teamsApi';
import { useTeamRole } from '../teams/useTeamRole';
import { useTheme } from '../../theme/useTheme';

type Props = {
  teamId: string;
  shiftId?: string;
  initial?: Shift;
};

export function ShiftEditor({ teamId, shiftId, initial }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [nowIso] = useState(() => new Date().toISOString());
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );
  const initialValues = useMemo(() => {
    if (initial) {
      return {
        assigneeId: initial.assigneeId,
        dateKey: localDateKey(initial.startsAt, timeZone),
        startTime: formatLocalTime(initial.startsAt, timeZone),
        endTime: formatLocalTime(initial.endsAt, timeZone),
      };
    }
    return {
      assigneeId: '',
      dateKey: nextDayChips(nowIso, timeZone)[0]?.dateKey ?? localDateKey(nowIso, timeZone),
      startTime: '09:00',
      endTime: '17:00',
    };
  }, [initial, nowIso, timeZone]);

  const [assigneeId, setAssigneeId] = useState(initialValues.assigneeId);
  const [dateKey, setDateKey] = useState(initialValues.dateKey);
  const [startTime, setStartTime] = useState(initialValues.startTime);
  const [endTime, setEndTime] = useState(initialValues.endTime);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const roleQuery = useTeamRole(teamId);
  const membersQuery = useQuery({
    queryKey: ['team', teamId, 'members'],
    queryFn: () => getMembers(teamId),
    staleTime: MEMBER_STALE_TIME,
    gcTime: MEMBER_GC_TIME,
  });

  const save = useMutation({
    mutationFn: (input: { assigneeId: string; startsAt: string; endsAt: string }) =>
      shiftId
        ? updateShift(teamId, shiftId, input)
        : createShift(teamId, input),
  });
  const remove = useMutation({
    mutationFn: () => deleteShift(teamId, shiftId ?? ''),
  });

  const busy = save.isPending || remove.isPending;

  async function refresh() {
    await Promise.all([roleQuery.query.refetch(), membersQuery.refetch()]);
  }

  async function invalidateTeamData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['team', teamId, 'shifts'] }),
      queryClient.invalidateQueries({ queryKey: ['team', teamId, 'activity'] }),
      queryClient.invalidateQueries({ queryKey: ['team', teamId, 'swaps'] }),
    ]);
  }

  async function handleSave() {
    setFormError(null);
    setFieldError(null);

    if (!assigneeId) {
      setFieldError('Choose who is working this shift.');
      return;
    }

    const startIso = combineLocalDateTime(dateKey, startTime, timeZone);
    const endIso = combineLocalDateTime(dateKey, endTime, timeZone);

    if (!isValidShiftWindow(startIso, endIso)) {
      setFieldError('End time must be after start time.');
      return;
    }

    try {
      await save.mutateAsync({ assigneeId, startsAt: startIso, endsAt: endIso });
      await invalidateTeamData();
      router.back();
    } catch (error) {
      setFormError(mapError(error, 'shift').message);
    }
  }

  async function handleDelete() {
    setFormError(null);
    try {
      await remove.mutateAsync();
      setConfirmDelete(false);
      await invalidateTeamData();
      router.back();
    } catch (error) {
      setFormError(mapError(error, 'shift').message);
      setConfirmDelete(false);
    }
  }

  if (roleQuery.query.isPending || membersQuery.isPending) {
    return (
      <Screen>
        <StateView loading />
      </Screen>
    );
  }

  if (!roleQuery.canManageShifts) {
    return (
      <Screen>
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="heading">Shifts unavailable</Text>
            <Text color={theme.colors.textMuted}>You don&apos;t have permission to do that</Text>
            <Button
              label="Back"
              variant="secondary"
              onPress={() => router.back()}
              accessibilityLabel="Back"
            />
          </View>
        </Card>
      </Screen>
    );
  }

  const error = roleQuery.query.error ?? membersQuery.error;
  if (error) {
    return (
      <Screen>
        <StateView errorMessage={mapError(error, 'team').message} onRetry={() => void refresh()} />
      </Screen>
    );
  }

  const members = membersQuery.data ?? [];

  return (
    <Screen refreshing={roleQuery.query.isRefetching || membersQuery.isRefetching} onRefresh={() => void refresh()}>
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="title">{shiftId ? 'Edit shift' : 'Create shift'}</Text>
          <Text color={theme.colors.textMuted}>Times are shown in your phone&apos;s local time.</Text>
          {fieldError ? (
            <Text color={theme.colors.error} accessibilityLiveRegion="polite">
              {fieldError}
            </Text>
          ) : null}
          {formError ? (
            <Text color={theme.colors.error} accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}
        </View>
      </Card>

      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">Who is working?</Text>
          {members.length === 0 ? <StateView emptyMessage="No team members are available." /> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {members.map((member) => (
              <Button
                key={member.id}
                label={member.email}
                variant={assigneeId === member.id ? 'primary' : 'secondary'}
                onPress={() => setAssigneeId(member.id)}
                disabled={busy}
                accessibilityLabel={`Assign shift to ${member.email}`}
              />
            ))}
          </View>
        </View>
      </Card>

      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <DateTimeFields
            label="Start"
            nowIso={nowIso}
            timeZone={timeZone}
            dateKey={dateKey}
            time={startTime}
            busy={busy}
            onDateChange={setDateKey}
            onTimeChange={setStartTime}
          />
          <DateTimeFields
            label="End"
            nowIso={nowIso}
            timeZone={timeZone}
            dateKey={dateKey}
            time={endTime}
            busy={busy}
            onDateChange={setDateKey}
            onTimeChange={setEndTime}
          />
        </View>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        <Button
          label="Save shift"
          onPress={() => void handleSave()}
          loading={save.isPending}
          disabled={busy}
          accessibilityLabel="Save shift"
        />
        {shiftId ? (
          <Button
            label="Delete shift"
            variant="secondary"
            onPress={() => setConfirmDelete(true)}
            disabled={busy}
            accessibilityLabel="Delete shift"
          />
        ) : null}
      </View>

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
                disabled={busy}
                accessibilityLabel="Confirm delete shift"
              />
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setConfirmDelete(false)}
                disabled={busy}
                accessibilityLabel="Cancel delete shift"
              />
            </View>
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
