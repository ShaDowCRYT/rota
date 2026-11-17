import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { Button } from './Button';
import { Text } from './Text';

type Props = {
  loading?: boolean;
  emptyMessage?: string;
  errorMessage?: string;
  onRetry?: () => void;
};

export function StateView({ loading, emptyMessage, errorMessage, onRetry }: Props) {
  const theme = useTheme();

  if (loading) {
    return (
      <View style={[styles.container, { padding: theme.spacing.xl }]} accessibilityRole="progressbar">
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text variant="body" style={{ marginTop: theme.spacing.md }}>
          Loading...
        </Text>
      </View>
    );
  }

  if (errorMessage) {
    return (
      <View style={[styles.container, { padding: theme.spacing.xl }]}>
        <Text variant="heading" align="center">
          Something went wrong
        </Text>
        <Text variant="body" color={theme.colors.textMuted} align="center" style={{ marginTop: theme.spacing.sm }}>
          {errorMessage}
        </Text>
        {onRetry ? (
          <Button
            label="Retry"
            onPress={onRetry}
            accessibilityLabel="Retry"
            style={{ marginTop: theme.spacing.lg }}
          />
        ) : null}
      </View>
    );
  }

  if (emptyMessage) {
    return (
      <View style={[styles.container, { padding: theme.spacing.xl }]}>
        <Text variant="body" color={theme.colors.textMuted} align="center">
          {emptyMessage}
        </Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
