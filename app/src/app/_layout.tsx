import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { bootstrapSession } from '../features/auth/authActions';
import { configureGoogle } from '../features/auth/googleClient';
import { getGoogleWebClientId } from '../features/auth/googleConfig';
import { useSessionStore } from '../features/auth/session';
import { useTheme } from '../theme/useTheme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
  },
});

function RootNavigator() {
  const status = useSessionStore((state) => state.status);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="forgot" />
      <Stack.Screen name="invite" />
      <Stack.Screen name="reset" />
      <Stack.Screen name="accept-invite" />
      <Stack.Screen name="join-invite" />
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="home" />
        <Stack.Screen name="account" />
        <Stack.Screen name="create-team" />
        <Stack.Screen name="team" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const theme = useTheme();

  useEffect(() => {
    void bootstrapSession();
    const webClientId = getGoogleWebClientId();
    if (webClientId) {
      configureGoogle(webClientId);
    }
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SafeAreaView
          style={{ flex: theme.layout.fill, backgroundColor: theme.colors.background }}
          edges={['top', 'bottom']}
        >
          <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} />
          <RootNavigator />
        </SafeAreaView>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
