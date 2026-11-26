import React from 'react';
import { View } from 'react-native';

import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

type Props = {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  loading?: boolean;
};

export function ConfirmPanel({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  loading = false,
}: Props) {
  const theme = useTheme();

  return (
    <View
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderWidth: theme.sizes.borderWidth,
        borderColor: theme.colors.warning,
        borderRadius: theme.radii.sm,
      }}
    >
      <Text color={theme.colors.warning}>{message}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        <Button
          label={confirmLabel}
          onPress={onConfirm}
          loading={loading}
          disabled={busy}
          accessibilityLabel={confirmLabel}
        />
        <Button
          label="Cancel"
          variant="secondary"
          onPress={onCancel}
          disabled={busy}
          accessibilityLabel="Cancel confirmation"
        />
      </View>
    </View>
  );
}
