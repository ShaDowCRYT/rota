import React, { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '../components/Screen';
import { StateView } from '../components/StateView';
import { normalizeDeepLinkToken } from '../features/links/deepLinks';
import { setPendingLink } from '../features/links/pendingLinkStore';
import { useSessionStore } from '../features/auth/session';
import { ResetPasswordScreen } from '../screens/ResetPasswordScreen';

export default function ResetRoute() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = normalizeDeepLinkToken(params.token);
  const status = useSessionStore((state) => state.status);
  const router = useRouter();

  useEffect(() => {
    if (!token || status === 'loading') return;
    setPendingLink('reset', token);
    router.replace('/reset');
  }, [token, status, router]);

  if (status === 'loading') {
    return (
      <Screen>
        <StateView loading />
      </Screen>
    );
  }

  return <ResetPasswordScreen />;
}
