import React, { useState } from 'react';
import { View } from 'react-native';

import { Button } from '../components/Button';
import { Text } from '../components/Text';
import { authActions } from '../features/auth/authActions';
import { useSessionStore } from '../features/auth/session';
import { StatusScreen } from '../screens/StatusScreen';
import { useTheme } from '../theme/useTheme';

type BusyAction = 'none' | 'logout' | 'logoutAll';

export default function HomeScreen() {
  const theme = useTheme();
  const user = useSessionStore((state) => state.user);
  const [busy, setBusy] = useState<BusyAction>('none');
  const [confirmAll, setConfirmAll] = useState(false);

  async function handleLogout() {
    setBusy('logout');
    try {
      await authActions.logout();
    } finally {
      setBusy('none');
    }
  }

  async function handleLogoutAll() {
    setBusy('logoutAll');
    try {
      await authActions.logoutAll();
    } finally {
      setBusy('none');
      setConfirmAll(false);
    }
  }

  return (
    <View style={{ flex: theme.layout.fill, backgroundColor: theme.colors.background }}>
      <View
        style={{
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
          borderBottomWidth: theme.sizes.borderWidth,
          borderBottomColor: theme.colors.border,
        }}
      >
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="heading">Signed in</Text>
          <Text variant="body" color={theme.colors.textMuted} accessibilityLabel={`Signed in as ${user?.email ?? 'unknown user'}`}>
            {user?.email ?? 'Signed in'}
          </Text>
        </View>

        <Button
          label="Log out"
          variant="secondary"
          onPress={() => void handleLogout()}
          loading={busy === 'logout'}
          disabled={busy !== 'none'}
          accessibilityLabel="Log out"
        />

        {confirmAll ? (
          <View
            style={{
              gap: theme.spacing.sm,
              padding: theme.spacing.md,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.sm,
              borderWidth: theme.sizes.borderWidth,
              borderColor: theme.colors.warning,
            }}
          >
            <Text color={theme.colors.warning}>
              Log out on every device? You will need to log in again everywhere.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              <Button
                label="Yes, log out everywhere"
                onPress={() => void handleLogoutAll()}
                loading={busy === 'logoutAll'}
                disabled={busy !== 'none'}
                accessibilityLabel="Confirm log out of all devices"
              />
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setConfirmAll(false)}
                disabled={busy !== 'none'}
                accessibilityLabel="Cancel log out of all devices"
              />
            </View>
          </View>
        ) : (
          <Button
            label="Log out of all devices"
            variant="secondary"
            onPress={() => setConfirmAll(true)}
            disabled={busy !== 'none'}
            accessibilityLabel="Log out of all devices"
          />
        )}
      </View>

      <View style={{ flex: theme.layout.fill }}>
        <StatusScreen />
      </View>
    </View>
  );
}
