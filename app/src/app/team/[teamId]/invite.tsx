import React, { useState } from 'react';
import { Share, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Input } from '../../../components/Input';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { Text } from '../../../components/Text';
import { mapError } from '../../../features/auth/errors';
import { isValidEmail, normalizeEmail } from '../../../features/auth/validation';
import {
  createInvite,
  listInvites,
  listTeams,
  revokeInvite,
  type InviteRole,
} from '../../../features/teams/teamsApi';
import { useTheme } from '../../../theme/useTheme';

export default function TeamInviteRoute() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ teamId: string }>();
  const teamId = params.teamId;

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('staff');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [confirmInviteId, setConfirmInviteId] = useState<string | null>(null);

  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: () => listTeams() });
  const invitesQuery = useQuery({
    queryKey: ['team', teamId, 'invites'],
    queryFn: () => listInvites(teamId),
    enabled: teamsQuery.data?.find((team) => team.id === teamId)?.role === 'owner',
  });

  const create = useMutation({
    mutationFn: (input: { email?: string; role: InviteRole }) => createInvite(teamId, input),
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => revokeInvite(teamId, inviteId),
  });

  const isOwner = teamsQuery.data?.find((team) => team.id === teamId)?.role === 'owner';
  const busy = create.isPending || revoke.isPending;

  async function handleCreate() {
    setFormError(null);
    if (email.trim() && !isValidEmail(email)) {
      setFieldError('Enter a valid email address or leave it blank.');
      return;
    }
    setFieldError(null);

    try {
      const result = await create.mutateAsync({
        email: email.trim() ? normalizeEmail(email) : undefined,
        role,
      });
      setCreatedLink(result.link);
      create.reset();
      await queryClient.invalidateQueries({ queryKey: ['team', teamId, 'invites'] });
    } catch (error) {
      setFormError(mapError(error, 'team').message);
      create.reset();
    }
  }

  async function handleRevoke(inviteId: string) {
    setFormError(null);
    try {
      await revoke.mutateAsync(inviteId);
      setConfirmInviteId(null);
      revoke.reset();
      await queryClient.invalidateQueries({ queryKey: ['team', teamId, 'invites'] });
    } catch (error) {
      setFormError(mapError(error, 'team').message);
      setConfirmInviteId(null);
      revoke.reset();
    }
  }

  async function shareLink() {
    if (!createdLink) return;
    await Share.share({ message: createdLink });
  }

  if (teamsQuery.isPending) {
    return (
      <Screen>
        <StateView loading />
      </Screen>
    );
  }

  if (!isOwner) {
    return (
      <Screen>
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="heading">Invites unavailable</Text>
            <Text color={theme.colors.textMuted}>
              You don&apos;t have permission to do that
            </Text>
            <Button
              label="Back to team"
              variant="secondary"
              onPress={() => router.back()}
              accessibilityLabel="Back to team"
            />
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      refreshing={invitesQuery.isRefetching && !invitesQuery.isPending}
      onRefresh={() => void invitesQuery.refetch()}
    >
      <Card>
        <View style={{ gap: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="title">Invite a member</Text>
            <Text color={theme.colors.textMuted}>
              Email is optional. The link works for anyone until it expires or is revoked.
            </Text>
          </View>

          <Input
            label="Email (optional)"
            value={email}
            onChangeText={setEmail}
            error={fieldError ?? undefined}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            maxLength={320}
          />

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label">Role</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              <Button
                label="Manager"
                variant={role === 'manager' ? 'primary' : 'secondary'}
                onPress={() => setRole('manager')}
                disabled={busy}
                accessibilityLabel="Invite as manager"
              />
              <Button
                label="Staff"
                variant={role === 'staff' ? 'primary' : 'secondary'}
                onPress={() => setRole('staff')}
                disabled={busy}
                accessibilityLabel="Invite as staff"
              />
            </View>
          </View>

          {formError ? (
            <Text color={theme.colors.error} accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}

          <Button
            label="Create invite"
            onPress={() => void handleCreate()}
            loading={create.isPending}
            disabled={busy}
            accessibilityLabel="Create invite"
          />

          {createdLink ? (
            <View
              style={{
                gap: theme.spacing.sm,
                padding: theme.spacing.md,
                borderWidth: theme.sizes.borderWidth,
                borderColor: theme.colors.success,
                borderRadius: theme.radii.sm,
              }}
            >
              <Text variant="label">Invite link</Text>
              <Text selectable accessibilityLabel="Invite link">
                {createdLink}
              </Text>
              <Button
                label="Share link"
                onPress={() => void shareLink()}
                variant="secondary"
                accessibilityLabel="Share invite link"
              />
            </View>
          ) : null}
        </View>
      </Card>

      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">Pending invites</Text>
          {invitesQuery.isPending ? <StateView loading /> : null}
          {invitesQuery.error ? (
            <StateView
              errorMessage={mapError(invitesQuery.error, 'team').message}
              onRetry={() => void invitesQuery.refetch()}
            />
          ) : null}
          {invitesQuery.data && invitesQuery.data.length === 0 ? (
            <StateView emptyMessage="No pending invites." />
          ) : null}
          {invitesQuery.data?.map((invite) => (
            <View key={invite.id} style={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }}>
              <Text variant="label">
                {invite.email ?? 'Anyone with the link'} — {invite.role}
              </Text>
              <Text variant="caption" color={theme.colors.textMuted}>
                Expires {new Date(invite.expiresAt).toLocaleDateString()}
              </Text>
              <Button
                label="Revoke"
                variant="secondary"
                onPress={() => setConfirmInviteId(invite.id)}
                disabled={busy}
                accessibilityLabel={`Revoke invite for ${invite.email ?? 'anyone with the link'}`}
              />
              {confirmInviteId === invite.id ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                  <Button
                    label="Yes, revoke"
                    onPress={() => void handleRevoke(invite.id)}
                    loading={revoke.isPending}
                    disabled={busy}
                    accessibilityLabel="Confirm revoke invite"
                  />
                  <Button
                    label="Cancel"
                    variant="secondary"
                    onPress={() => setConfirmInviteId(null)}
                    disabled={busy}
                    accessibilityLabel="Cancel revoke invite"
                  />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </Card>
    </Screen>
  );
}
