import { createContext } from 'react';

import { resolveTeamIdParam } from '../../api/ids';

export type TeamIdContextValue = {
  teamId: string | null;
};

export const TeamIdContext = createContext<TeamIdContextValue | null>(null);

export function createTeamIdContextValue(rawTeamId: unknown): TeamIdContextValue {
  return { teamId: resolveTeamIdParam(rawTeamId) ?? null };
}

export function readTeamIdContextValue(value: TeamIdContextValue | null): string | undefined {
  return value?.teamId ?? undefined;
}
