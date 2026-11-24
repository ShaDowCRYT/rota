import React, { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { StateView } from '../components/StateView';
import { Text } from '../components/Text';
import { ApiFailure, mapError } from '../features/auth/errors';
import { useSessionStore } from '../features/auth/session';
import { clearPendingLink, readPendingLink } from '../features/links/pendingLinkStore';
import { useTheme } from '../theme/useTheme';
import { acceptInvite } from '../features/teams/teamsApi';

export function AcceptInviteScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useSessionStore((state) => state.status);
  const token = readPendingLink('invite');
  const [locked, setLocked] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const accept = useMutation({ mutationFn: (inviteToken: string) => acceptInvite(inviteToken) });

  async function handleAccept() {
    if (!token) return;
    setErrorMessage(null);
    try {
      const team = await accept.mutateAsync(token);
      clearPendingLink();
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
      router.push({ pathname: '/team/[teamId]', params: { teamId: team.id } });
    } catch (error) {
      const friendly = mapError(error, 'invite');
      setErrorMessage(friendly.message);
      if (error instanceof ApiFailure && [400, 401, 403, 409].includes(error.status)) {
        clearPendingLink();
        setLocked(true);
      }
      await queryClient.invalidateQueries({ queryKey: ['teams'] }).catch(() => undefined);
    } finally {
      accept.reset();
    }
  }

  if (status === 'loading') {
    return (
      <Screen>
        <StateView loading />
      </Screen>
    );
  }

  if (!token || locked) {
    return (
      <Screen>
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="heading">Invite unavailable</Text>
            <Text color={theme.colors.textMuted}>
              {errorMessage ?? 'This link is invalid or has expired.'}
            </Text>
            <Button
              label="Go to Home"
              variant="secondary"
              onPress={() => router.replace(status === 'signedIn' ? '/home' : '/login')}
              accessibilityLabel="Go to Home"
            />
          </View>
        </Card>
      </Screen>
    );
  }

  if (status === 'signedOut') {
    return (
      <Screen>
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="heading">You have an invite</Text>
            <Text color={theme.colors.textMuted}>
              Log in or create an account, then come back to join the team. If you close the app
              first, open this link again.
            </Text>
            <Button
              label="Log in to join"
              onPress={() => router.replace('/login')}
              accessibilityLabel="Log in to join the team"
            />
            <Button
              label="Create account to join"
              variant="secondary"
              onPress={() => router.replace('/signup')}
              accessibilityLabel="Create an account to join the team"
            />
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">Join this team?</Text>
          <Text color={theme.colors.textMuted}>
            Accept the invite to join the team with the role chosen by the owner.
          </Text>
          {errorMessage ? (
            <Text color={theme.colors.error} accessibilityLiveRegion="polite">
              {errorMessage}
            </Text>
          ) : null}
          <Button
            label="Join this team"
            onPress={() => void handleAccept()}
            loading={accept.isPending}
            disabled={accept.isPending}
            accessibilityLabel="Join this team"
          />
          <Link
            href="/home"
            accessibilityRole="link"
            accessibilityLabel="Go back to Home"
            style={{
              color: theme.colors.primary,
              fontSize: theme.typeScale.label.fontSize,
              lineHeight: theme.typeScale.label.lineHeight,
            }}
          >
            Not now
          </Link>
        </View>
      </Card>
    </Screen>
  );
}
