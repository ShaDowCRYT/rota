export type Role = "owner" | "manager" | "staff";
export type InviteRole = Exclude<Role, "owner">;

export interface TeamRecord {
  id: string;
  name: string;
}

export interface TeamSummary extends TeamRecord {
  role: Role;
}

export interface MembershipRecord {
  teamId: string;
  userId: string;
  role: Role;
}

export interface MemberRecord {
  userId: string;
  role: Role;
}

export interface MemberView {
  id: string;
  email: string;
  role: Role;
}

export interface NewInviteRecord {
  teamId: string;
  invitedBy: string;
  email: string | null;
  role: InviteRole;
  tokenHash: string;
  expiresAt: Date;
}

export interface InviteRecord extends NewInviteRecord {
  id: string;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface InviteSummaryRecord {
  id: string;
  teamId: string;
  invitedBy: string;
  email: string | null;
  role: InviteRole;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface InviteView {
  id: string;
  email: string | null;
  role: InviteRole;
  expiresAt: string;
}

export interface CreatedInvite extends InviteView {
  link: string;
}

export class DuplicateTokenError extends Error {
  constructor() {
    super("duplicate token");
    this.name = "DuplicateTokenError";
  }
}

export interface TeamsRepository {
  createTeamWithOwner(userId: string, name: string): Promise<TeamRecord>;
  listTeamsForUser(userId: string): Promise<TeamSummary[]>;
  countOwnedTeams(userId: string): Promise<number>;
  findTeam(teamId: string): Promise<TeamRecord | undefined>;
  findMembership(
    teamId: string,
    userId: string,
  ): Promise<MembershipRecord | undefined>;
  createMembership(
    teamId: string,
    userId: string,
    role: Role,
  ): Promise<boolean>;
  listMemberships(teamId: string): Promise<MemberRecord[]>;
  updateRole(teamId: string, userId: string, role: InviteRole): Promise<void>;
  removeMembership(teamId: string, userId: string): Promise<void>;
  addUserTeam(userId: string, teamId: string): Promise<void>;
  removeUserTeam(userId: string, teamId: string): Promise<void>;
  createInvite(invite: NewInviteRecord): Promise<InviteRecord>;
  findInviteByTokenHash(tokenHash: string): Promise<InviteRecord | undefined>;
  consumeInvite(id: string): Promise<InviteRecord | undefined>;
  releaseInvite(id: string): Promise<void>;
  listInvites(teamId: string): Promise<InviteSummaryRecord[]>;
  revokeInvite(teamId: string, inviteId: string): Promise<void>;
}

export interface TeamsService {
  createTeam(userId: string, name: string): Promise<TeamSummary>;
  listTeams(userId: string): Promise<TeamSummary[]>;
  getTeam(teamId: string): Promise<TeamRecord>;
  getMembership(
    teamId: string,
    userId: string,
  ): Promise<MembershipRecord | undefined>;
  getMembers(teamId: string): Promise<MemberView[]>;
  changeRole(
    teamId: string,
    userId: string,
    role: InviteRole,
  ): Promise<void>;
  removeMember(teamId: string, userId: string): Promise<void>;
  createInvite(
    teamId: string,
    invitedBy: string,
    email: string | null,
    role: InviteRole,
  ): Promise<CreatedInvite>;
  listInvites(teamId: string): Promise<InviteView[]>;
  revokeInvite(teamId: string, inviteId: string): Promise<void>;
  resolveInviteTeamId(token: string): Promise<string>;
  acceptInvite(
    userId: string,
    email: string,
    token: string,
  ): Promise<TeamSummary>;
}
