import type { Role } from './teamsApi';

export function canInviteMembers(role: Role | undefined): boolean {
  return role === 'owner';
}

export function canManageMember(actorRole: Role | undefined, memberRole: Role): boolean {
  return actorRole === 'owner' && memberRole !== 'owner';
}
