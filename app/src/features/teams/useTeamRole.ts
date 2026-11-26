import { useQuery } from '@tanstack/react-query';

import { listTeams, TEAM_GC_TIME, TEAM_STALE_TIME } from './teamsApi';

export function useTeamRole(teamId: string) {
  const query = useQuery({
    queryKey: ['teams'],
    queryFn: () => listTeams(),
    staleTime: TEAM_STALE_TIME,
    gcTime: TEAM_GC_TIME,
  });
  const role = query.data?.find((team) => team.id === teamId)?.role;

  return {
    query,
    role,
    isOwner: role === 'owner',
    isManager: role === 'manager',
    canManageShifts: role === 'owner' || role === 'manager',
  };
}
