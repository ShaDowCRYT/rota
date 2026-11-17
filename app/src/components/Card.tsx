import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { useTheme } from '../theme/useTheme';

type Props = ViewProps & {
  children: React.ReactNode;
};

export function Card({ children, style, ...rest }: Props) {
  const theme = useTheme();
  return (
    <View
      {...rest}
      style={[
        styles.base,
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.lg,
          padding: theme.spacing.lg,
          borderColor: theme.colors.border,
          borderWidth: theme.sizes.borderWidth,
        },
        theme.shadows.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {},
});
