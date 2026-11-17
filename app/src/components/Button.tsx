import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';

type Variant = 'primary' | 'secondary';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
  style?: ViewStyle;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityLabel,
  style,
}: Props) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  const backgroundColor = variant === 'primary' ? theme.colors.primary : theme.colors.secondary;
  const textColor = variant === 'primary' ? theme.colors.onPrimary : theme.colors.onSecondary;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: theme.sizes.touchTargetMin,
          backgroundColor,
          borderRadius: theme.radii.md,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          opacity: pressed || isDisabled ? 0.7 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={textColor} /> : <Text variant="label" color={textColor}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
