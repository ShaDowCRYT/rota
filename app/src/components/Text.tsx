import React from 'react';
import { Text as RNText, TextProps as RNTextProps, TextStyle } from 'react-native';
import { useTheme } from '../theme/useTheme';

type Variant = 'title' | 'heading' | 'body' | 'label' | 'caption';

type Props = RNTextProps & {
  variant?: Variant;
  color?: string;
  align?: TextStyle['textAlign'];
};

export function Text({ variant = 'body', color, align, style, ...rest }: Props) {
  const theme = useTheme();
  const scale = theme.typeScale[variant];
  return (
    <RNText
      {...rest}
      style={[
        {
          color: color ?? theme.colors.text,
          fontSize: scale.fontSize,
          lineHeight: scale.lineHeight,
          fontWeight: scale.fontWeight,
          textAlign: align,
        },
        style,
      ]}
    />
  );
}
