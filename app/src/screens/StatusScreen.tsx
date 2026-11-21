import React, { useEffect } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ApiError, getHealthReady, HealthReadyResponse } from '../api/client';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { StateView } from '../components/StateView';
import { Text } from '../components/Text';
import { useTheme } from '../theme/useTheme';

export function StatusScreen() {
  const theme = useTheme();
  const { data, error, isPending, isRefetching, refetch } = useQuery({
    queryKey: ['health-ready'],
    queryFn: getHealthReady,
  });

  useEffect(() => {
    if (error && __DEV__) {
      console.error('Health check failed', error);
    }
  }, [error]);

  const errorMessage = getFriendlyErrorMessage(error);

  return (
    <ScrollView
      style={{ flex: theme.layout.fill, backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { padding: theme.spacing.lg }]}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching && !isPending}
          onRefresh={() => {
            void refetch();
          }}
          tintColor={theme.colors.primary}
        />
      }
    >
      <View style={{ marginBottom: theme.spacing.lg }}>
        <Text variant="title">Rota</Text>
        <Text variant="body" color={theme.colors.textMuted} style={{ marginTop: theme.spacing.xs }}>
          Server status
        </Text>
      </View>

      {isPending ? <StateView loading /> : null}

      {!isPending && error ? <StateView errorMessage={errorMessage} onRetry={() => void refetch()} /> : null}

      {!isPending && !error && data ? (
        <Card>
          <Text variant="heading">Ready</Text>
          <View style={{ marginTop: theme.spacing.md }}>
            <StatusRow label="Database" value={data.database} />
            <View style={{ height: theme.spacing.sm }} />
            <StatusRow label="Redis" value={data.redis} />
          </View>
          <Button
            label="Refresh"
            variant="secondary"
            onPress={() => void refetch()}
            accessibilityLabel="Refresh server status"
            style={{ marginTop: theme.spacing.lg }}
          />
        </Card>
      ) : null}
    </ScrollView>
  );
}

function getFriendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'unreachable') {
      return "Can't reach the server. Check your connection and try again.";
    }
    if (error.kind === 'timeout') {
      return 'The server took too long to answer. Try again.';
    }
    if (error.kind === 'service_unavailable') {
      return formatServiceUnavailable(error.details);
    }
  }
  return 'Something went wrong. Try again.';
}

function formatServiceUnavailable(details?: HealthReadyResponse): string {
  if (!details) {
    return 'The server is up but a service is down.';
  }
  const unavailable: string[] = [];
  if (details.database !== 'ok') unavailable.push('Database: unavailable');
  if (details.redis !== 'ok') unavailable.push('Redis: unavailable');
  const services = unavailable.length > 0 ? unavailable.join(', ') : 'A service is unavailable';
  return `${services}. The server is up but a service is down.`;
}

function StatusRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  const isOk = value === 'ok';
  return (
    <View style={styles.row}>
      <Text variant="label">{label}</Text>
      <Text variant="label" color={isOk ? theme.colors.success : theme.colors.error}>
        {isOk ? 'OK' : 'Error'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
