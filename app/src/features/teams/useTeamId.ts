import { useContext } from 'react';

import { TeamIdContext, readTeamIdContextValue } from './teamIdContext';

export function useTeamId(): string {
  const value = useContext(TeamIdContext);
  const teamId = readTeamIdContextValue(value);

  if (!teamId) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      throw new Error('useTeamId must be used inside TeamIdProvider with a valid team id.');
    }
    return '';
  }

  return teamId;
}
