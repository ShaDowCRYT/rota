import React, { useMemo, useRef, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { Button } from '../../../../components/Button';
import { Card } from '../../../../components/Card';
import { Screen } from '../../../../components/Screen';
import { StateView } from '../../../../components/StateView';
import { Text } from '../../../../components/Text';
import {
  FEED_GC_TIME,
  FEED_STALE_TIME,
  listActivity,
  type ActivityEvent,
} from '../../../../features/activity/activityApi';
import { describeActivityEvent, relativeTime } from '../../../../features/activity/eventText';
import {
  canFetchNextPage,
  createFeedPageGate,
  mergeFeedPages,
} from '../../../../features/activity/feedMerge';
import { mapError } from '../../../../features/auth/errors';
import { useTeamId } from '../../../../features/teams/useTeamId';
import {
  getMembers,
  MEMBER_GC_TIME,
  MEMBER_STALE_TIME,
} from '../../../../features/teams/teamsApi';
import { useTheme } from '../../../../theme/useTheme';

export default function ActivityTab() {
  const theme = useTheme();
  const teamId = useTeamId();
  const [nowIso] = useState(() => new Date().toISOString());
  const gate = useRef(createFeedPageGate()).current;

  const membersQuery = useQuery({
    queryKey: ['team', teamId, 'members'],
    queryFn: () => getMembers(teamId),
    staleTime: MEMBER_STALE_TIME,
    gcTime: MEMBER_GC_TIME,
  });
  const feedQuery = useInfiniteQuery({
    queryKey: ['team', teamId, 'activity'],
    queryFn: ({ pageParam }) => listActivity(teamId, pageParam ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: FEED_STALE_TIME,
    gcTime: FEED_GC_TIME,
  });

  const events = useMemo(
    () => mergeFeedPages(feedQuery.data?.pages ?? []),
    [feedQuery.data?.pages],
  );
  const emailById = useMemo(
    () =>
      new Map((membersQuery.data ?? []).map((member) => [member.id, member.email] as const)),
    [membersQuery.data],
  );
  const lastCursor = feedQuery.data?.pages.at(-1)?.nextCursor ?? null;
  const loading = feedQuery.isPending || membersQuery.isPending;
  const firstPageError = feedQuery.error && !feedQuery.data;

  async function refreshAll() {
    await Promise.all([feedQuery.refetch(), membersQuery.refetch()]);
  }

  function loadMore() {
    const allowed = canFetchNextPage({
      nextCursor: lastCursor,
      hasNextPage: feedQuery.hasNextPage,
      isFetchingNextPage: feedQuery.isFetchingNextPage,
    });
    if (!allowed || !gate.claim()) return;
    void feedQuery.fetchNextPage().finally(() => gate.release());
  }

  if (loading) {
    return (
      <Screen>
        <StateView loading />
      </Screen>
    );
  }

  if (firstPageError || membersQuery.error) {
    const error = membersQuery.error ?? feedQuery.error;
    return (
      <Screen>
        <StateView
          errorMessage={mapError(error, 'team').message}
          onRetry={() => void refreshAll()}
        />
      </Screen>
    );
  }

  const refreshing = feedQuery.isRefetching || membersQuery.isRefetching;

  return (
    <Screen scroll={false}>
      <FlashList<ActivityEvent>
        data={events}
        contentContainerStyle={{
          flexGrow: theme.layout.fill,
          padding: theme.spacing.lg,
        }}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="body">{describeActivityEvent(item, emailById)}</Text>
              <Text variant="caption" color={theme.colors.textMuted}>
                {relativeTime(item.createdAt, nowIso)}
              </Text>
            </View>
          </Card>
        )}
        ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.xs, paddingBottom: theme.spacing.lg }}>
            <Text variant="title">Activity</Text>
            <Text variant="body" color={theme.colors.textMuted}>
              Recent changes in this team.
            </Text>
          </View>
        }
        ListEmptyComponent={<StateView emptyMessage="No activity yet." />}
        ListFooterComponent={
          <View style={{ gap: theme.spacing.md, paddingTop: theme.spacing.lg }}>
            {feedQuery.isFetchingNextPage ? <StateView loading /> : null}
            {feedQuery.error && feedQuery.data ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="caption" color={theme.colors.error}>
                  More activity could not load.
                </Text>
                <Button
                  label="Retry"
                  variant="secondary"
                  onPress={loadMore}
                  accessibilityLabel="Retry loading more activity"
                />
              </View>
            ) : null}
            {!feedQuery.hasNextPage && events.length > 0 && !feedQuery.error ? (
              <Text variant="caption" color={theme.colors.textMuted} align="center">
                You are all caught up
              </Text>
            ) : null}
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refreshAll()}
            tintColor={theme.colors.primary}
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
      />
    </Screen>
  );
}
