import React from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';

import { retryBootstrap } from '../features/auth/authActions';
import { useSessionStore } from '../features/auth/session';
import { StateView } from '../components/StateView';
import { useTheme } from '../theme/useTheme';

export default function IndexScreen() {
  const theme = useTheme();
  const status = useSessionStore((state) => state.status);
  const startupError = useSessionStore((state) => state.startupError);

  if (startupError) {
    return (
      <View style={{ flex: theme.layout.fill, justifyContent: 'center', backgroundColor: theme.colors.background }}>
        <StateView errorMessage={startupError.message} onRetry={() => void retryBootstrap()} />
      </View>
    );
  }

  if (status === 'loading') {
    return (
      <View style={{ flex: theme.layout.fill, justifyContent: 'center', backgroundColor: theme.colors.background }}>
        <StateView loading />
      </View>
    );
  }

  if (status === 'signedIn') {
    return <Redirect href="/home" />;
  }

  return <Redirect href="/login" />;
}
