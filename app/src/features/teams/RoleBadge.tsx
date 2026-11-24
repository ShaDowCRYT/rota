import React from 'react';
import { View } from 'react-native';

import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import type { Role } from './teamsApi';

export function RoleBadge({ role }: { role: Role }) {
  const theme = useTheme();
  const label = role.charAt(0).toUpperCase() + role.slice(1);
  const isOwner = role === 'owner';

  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.radii.sm,
        backgroundColor: isOwner ? theme.colors.secondary : theme.colors.surface,
        borderWidth: theme.sizes.borderWidth,
        borderColor: theme.colors.border,
      }}
      accessibilityLabel={`Role: ${label}`}
    >
      <Text variant="caption" color={isOwner ? theme.colors.onSecondary : theme.colors.textMuted}>
        {label}
      </Text>
    </View>
  );
}
