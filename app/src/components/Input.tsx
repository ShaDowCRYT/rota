import React, { useState } from 'react';
import { Pressable, TextInput as RNTextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';

import { useTheme } from '../theme/useTheme';
import { Text } from './Text';

type Props = TextInputProps & {
  label: string;
  error?: string;
  secureToggle?: boolean;
};

export function Input({ label, error, secureToggle = false, ...rest }: Props) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const isSecure = secureToggle && !visible;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="label">{label}</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: theme.sizes.touchTargetMin,
          backgroundColor: theme.colors.surface,
          borderColor: error ? theme.colors.error : theme.colors.border,
          borderWidth: theme.sizes.borderWidth,
          borderRadius: theme.radii.sm,
        }}
      >
        <RNTextInput
          {...rest}
          secureTextEntry={isSecure}
          accessibilityLabel={label}
          placeholderTextColor={theme.colors.textMuted}
          style={{
            flex: theme.layout.fill,
            color: theme.colors.text,
            fontSize: theme.typeScale.body.fontSize,
            lineHeight: theme.typeScale.body.lineHeight,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
          }}
        />
        {secureToggle ? (
          <Pressable
            onPress={() => setVisible((current) => !current)}
            accessibilityRole="button"
            accessibilityLabel={`${visible ? 'Hide' : 'Show'} ${label}`}
            style={{
              minWidth: theme.sizes.touchTargetMin,
              minHeight: theme.sizes.touchTargetMin,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="label" color={theme.colors.primary}>
              {visible ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" color={theme.colors.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
