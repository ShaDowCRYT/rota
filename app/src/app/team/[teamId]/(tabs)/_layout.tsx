import React from 'react';
import { Tabs } from 'expo-router';

import { useTheme } from '../../../../theme/useTheme';

export default function TeamTabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: theme.sizes.borderWidth,
        },
        tabBarLabelStyle: { fontSize: theme.typeScale.caption.fontSize },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Schedule', tabBarAccessibilityLabel: 'Schedule tab' }}
      />
      <Tabs.Screen
        name="members"
        options={{ title: 'Members', tabBarAccessibilityLabel: 'Members tab' }}
      />
      <Tabs.Screen
        name="activity"
        options={{ title: 'Activity', tabBarAccessibilityLabel: 'Activity tab' }}
      />
      <Tabs.Screen
        name="swaps"
        options={{ title: 'Swaps', tabBarAccessibilityLabel: 'Swaps tab' }}
      />
    </Tabs>
  );
}
