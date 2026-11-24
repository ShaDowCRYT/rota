import React, { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { mapError } from '../features/auth/errors';
import { isValidTeamName, MAX_TEAM_NAME_LENGTH, normalizeTeamName } from '../features/auth/validation';
import { createTeam } from '../features/teams/teamsApi';
import { useTheme } from '../theme/useTheme';

export default function CreateTeamRoute() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({ mutationFn: (teamName: string) => createTeam(teamName) });

  async function handleSubmit() {
    setFormError(null);
    if (!isValidTeamName(name)) {
      setFieldError(`Enter a team name between 1 and ${MAX_TEAM_NAME_LENGTH} characters.`);
      return;
    }
    setFieldError(null);

    try {
      const team = await mutation.mutateAsync(normalizeTeamName(name));
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
      router.push({ pathname: '/team/[teamId]', params: { teamId: team.id } });
    } catch (error) {
      setFormError(mapError(error, 'team').message);
    } finally {
      mutation.reset();
    }
  }

  return (
    <Screen>
      <Card>
        <View style={{ gap: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="title">Create a team</Text>
            <Text color={theme.colors.textMuted}>
              You will be the Owner. Only Owners invite members and manage roles.
            </Text>
          </View>

          <Input
            label="Team name"
            value={name}
            onChangeText={setName}
            error={fieldError ?? undefined}
            autoCapitalize="words"
            maxLength={MAX_TEAM_NAME_LENGTH}
            returnKeyType="done"
            onSubmitEditing={() => void handleSubmit()}
          />

          {formError ? (
            <Text color={theme.colors.error} accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}

          <Button
            label="Create team"
            onPress={() => void handleSubmit()}
            loading={mutation.isPending}
            disabled={mutation.isPending}
            accessibilityLabel="Create team"
          />
        </View>
      </Card>
    </Screen>
  );
}
