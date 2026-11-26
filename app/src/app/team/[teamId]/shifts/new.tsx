import React from 'react';
import { ShiftEditor } from '../../../../features/shifts/ShiftEditor';
import { useTeamId } from '../../../../features/teams/useTeamId';

export default function NewShiftRoute() {
  const teamId = useTeamId();
  return <ShiftEditor teamId={teamId} />;
}
