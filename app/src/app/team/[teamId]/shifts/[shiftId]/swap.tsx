import React, { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button } from '../../../../../components/Button';
import { Card } from '../../../../../components/Card';
import { Screen } from '../../../../../components/Screen';
import { StateView } from '../../../../../components/StateView';
import { Text } from '../../../../../components/Text';
import { mapError } from '../../../../../features/auth/errors';
import { useSessionStore } from '../../../../../features/auth/session';
import { formatLocalDateTime } from '../../../../../features/schedule/dateTime';
import {
  applyOptimisticSwap,
  createSwapSubmitGuard,
  restoreSwapList,
} from '../../../../../features/swaps/optimistic';
import { useSwapNoticeStore } from '../../../../../features/swaps/swapNoticeStore';
import { requestSwap, type SwapRequestView } from '../../../../../features/swaps/swapsApi';
import {
  getMembers,
  MEMBER_GC_TIME,
  MEMBER_STALE_TIME,
} from '../../../../../features/teams/teamsApi';
import { useTeamId } from '../../../../../features/teams/useTeamId';
import { useTheme } from '../../../../../theme/useTheme';

export default function RequestSwapRoute() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    teamId: string;
    shiftId: string;
    startsAt: string;
    endsAt: string;
  }>();
  const teamId = useTeamId();
  const shiftId = params.shiftId;
  const userId = useSessionStore((state) => state.user?.id);
  const setNotice = useSwapNoticeStore((state) => state.setMessage);
  const guard = useRef(createSwapSubmitGuard()).current;
  const [targetId, setTargetId] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );

  const membersQuery = useQuery({
    queryKey: ['team', teamId, 'members'],
    queryFn: () => getMembers(teamId),
    staleTime: MEMBER_STALE_TIME,
    gcTime: MEMBER_GC_TIME,
  });

  const queryKey = ['team', teamId, 'swaps'] as const;

  const mutation = useMutation({
    mutationFn: (chosenId: string | undefined) => requestSwap(teamId, shiftId, chosenId),
    onMutate: async (chosenId) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SwapRequestView[]>(queryKey);
      const optimistic: SwapRequestView = {
        id: `optimistic-${shiftId}`,
        shiftId,
        requesterId: userId ?? '',
        targetId: chosenId ?? null,
        status: 'pending',
      };
      queryClient.setQueryData<SwapRequestView[]>(queryKey, (current) =>
        applyOptimisticSwap(current, optimistic),
      );
      return { previous };
    },
    onError: (error, _chosenId, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, restoreSwapList(context.previous));
      } else {
        queryClient.removeQueries({ queryKey });
      }
      setNotice(mapError(error, 'swap').message);
      router.back();
    },
    onSuccess: () => {
      router.back();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ['team', teamId, 'shifts'] });
      guard.release(shiftId);
    },
  });

  async function refresh() {
    await membersQuery.refetch();
  }

  function submit() {
    if (!guard.claim(shiftId)) return;
    setFormError(null);
    if (!userId) {
      guard.release(shiftId);
      setFormError('Your session has ended. Please log in again.');
      return;
    }
    mutation.mutate(targetId);
  }

  if (membersQuery.isPending) {
    return (
      <Screen>
        <StateView loading />
      </Screen>
    );
  }

  if (membersQuery.error) {
    return (
      <Screen>
        <StateView
          errorMessage={mapError(membersQuery.error, 'team').message}
          onRetry={() => void refresh()}
        />
      </Screen>
    );
  }

  const teammates = (membersQuery.data ?? []).filter((member) => member.id !== userId);

  return (
    <Screen refreshing={membersQuery.isRefetching} onRefresh={() => void refresh()}>
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="title">Request a swap</Text>
          {params.startsAt && params.endsAt ? (
            <Text variant="body" color={theme.colors.textMuted}>
              {formatLocalDateTime(params.startsAt, timeZone)} to{' '}
              {formatLocalDateTime(params.endsAt, timeZone)}
            </Text>
          ) : null}
          <Text color={theme.colors.textMuted}>
            Choose one teammate, or leave it open for the team.
          </Text>
          {formError ? (
            <Text color={theme.colors.error} accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}
        </View>
      </Card>

      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">Teammates</Text>
          {teammates.length === 0 ? (
            <StateView emptyMessage="No teammates are available for a swap." />
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {teammates.map((member) => (
              <Button
                key={member.id}
                label={member.email}
                variant={targetId === member.id ? 'primary' : 'secondary'}
                onPress={() => setTargetId(member.id)}
                disabled={mutation.isPending}
                accessibilityLabel={`Ask ${member.email} to take the shift`}
              />
            ))}
          </View>
          <Button
            label="Open to the team"
            variant={targetId === undefined ? 'primary' : 'secondary'}
            onPress={() => setTargetId(undefined)}
            disabled={mutation.isPending}
            accessibilityLabel="Open the swap to the team"
          />
        </View>
      </Card>

      <Button
        label="Send request"
        onPress={submit}
        loading={mutation.isPending}
        disabled={mutation.isPending}
        accessibilityLabel="Send swap request"
      />
    </Screen>
  );
}
