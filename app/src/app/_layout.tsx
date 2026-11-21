import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { bootstrapSession } from '../features/auth/authActions';
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
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="home" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const theme = useTheme();

  useEffect(() => {
    void bootstrapSession();
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
