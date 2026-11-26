import React from 'react';
import { ScrollView, RefreshControl, View } from 'react-native';

import { useTheme } from '../theme/useTheme';

type Props = {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
};

export function Screen({ children, refreshing = false, onRefresh, scroll = true }: Props) {
  const theme = useTheme();

  if (!scroll) {
    return (
      <View style={{ flex: theme.layout.fill, backgroundColor: theme.colors.background }}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: theme.layout.fill, backgroundColor: theme.colors.background }}
      contentContainerStyle={{
        flexGrow: theme.layout.fill,
        padding: theme.spacing.lg,
        gap: theme.spacing.lg,
      }}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}
