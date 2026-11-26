import React, { useState } from 'react';
import { Share, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Input } from '../../components/Input';
import { StateView } from '../../components/StateView';
import { Text } from '../../components/Text';
import { mapError } from '../auth/errors';
import { inviteEmail, inviteEmailIsValid, shareInviteLink } from './inviteDraft';
import {
  createInvite,
  listInvites,
  MEMBER_GC_TIME,
  MEMBER_STALE_TIME,
  revokeInvite,
  type InviteRole,
} from './teamsApi';
import { useTheme } from '../../theme/useTheme';

type Props = {
  teamId: string;
  isOwner: boolean;
};

export function InvitesPanel({ teamId, isOwner }: Props) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('staff');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [confirmInviteId, setConfirmInviteId] = useState<string | null>(null);

  const invitesQuery = useQuery({
    queryKey: ['team', teamId, 'invites'],
    queryFn: () => listInvites(teamId),
    enabled: isOwner,
    staleTime: MEMBER_STALE_TIME,
    gcTime: MEMBER_GC_TIME,
  });

  const create = useMutation({
    mutationFn: (input: { email?: string; role: InviteRole }) => createInvite(teamId, input),
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => revokeInvite(teamId, inviteId),
  });

  const busy = create.isPending || revoke.isPending;

  async function refreshInvites() {
    await queryClient.invalidateQueries({ queryKey: ['team', teamId, 'invites'] });
  }

  async function handleCreate() {
    setFormError(null);
    if (!inviteEmailIsValid(email)) {
      setFieldError('Enter a valid email address or leave it blank.');
      return;
    }
    setFieldError(null);

    try {
      const result = await create.mutateAsync({ email: inviteEmail(email), role });
      setCreatedLink(result.link);
      setEmail('');
      create.reset();
      await refreshInvites();
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
      await refreshInvites();
    } catch (error) {
      setFormError(mapError(error, 'team').message);
      setConfirmInviteId(null);
      revoke.reset();
    }
  }

  async function shareLink() {
    if (!createdLink) return;
    try {
      await Share.share(shareInviteLink(createdLink));
    } catch {
      setFormError('Sharing did not open. Copy the link instead.');
    }
  }

  if (!isOwner) return null;

  return (
    <>
      <Card>
        <View style={{ gap: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="heading">Invites</Text>
            <Text color={theme.colors.textMuted}>
              Email is optional. The link is shown once, then works until it expires or is revoked.
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
              <Text variant="label">Invite link (shown once)</Text>
              <Text selectable accessibilityLabel="Invite link">
                {createdLink}
              </Text>
              <Button
                label="Share link"
                variant="secondary"
                onPress={() => void shareLink()}
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
          {invitesQuery.error && !invitesQuery.isPending ? (
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
                <View
                  style={{
                    gap: theme.spacing.sm,
                    padding: theme.spacing.md,
                    borderWidth: theme.sizes.borderWidth,
                    borderColor: theme.colors.warning,
                    borderRadius: theme.radii.sm,
                  }}
                >
                  <Text color={theme.colors.warning}>Revoke this invite? The link will stop working.</Text>
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
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </Card>
    </>
  );
}
