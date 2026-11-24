import React from 'react';
import { View } from 'react-native';

import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import type { MemberView } from './teamsApi';
import { RoleBadge } from './RoleBadge';

type Props = {
  member: MemberView;
  canManage: boolean;
  busy: boolean;
  onChangeRole: (userId: string, role: 'manager' | 'staff') => void;
  onRemove: (userId: string) => void;
};

export function MemberRow({ member, canManage, busy, onChangeRole, onRemove }: Props) {
  const theme = useTheme();
  const isOwner = member.role === 'owner';

  return (
    <View style={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.sm,
        }}
      >
        <Text variant="label" style={{ flex: theme.layout.fill }}>
          {member.email}
        </Text>
        <RoleBadge role={member.role} />
      </View>

      {canManage && !isOwner ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          <Button
            label="Make manager"
            variant={member.role === 'manager' ? 'primary' : 'secondary'}
            onPress={() => onChangeRole(member.id, 'manager')}
            disabled={busy || member.role === 'manager'}
            accessibilityLabel={`Make ${member.email} a manager`}
          />
          <Button
            label="Make staff"
            variant={member.role === 'staff' ? 'primary' : 'secondary'}
            onPress={() => onChangeRole(member.id, 'staff')}
            disabled={busy || member.role === 'staff'}
            accessibilityLabel={`Make ${member.email} staff`}
          />
          <Button
            label="Remove"
            variant="secondary"
            onPress={() => onRemove(member.id)}
            disabled={busy}
            accessibilityLabel={`Remove ${member.email} from the team`}
          />
        </View>
      ) : null}
    </View>
  );
}
