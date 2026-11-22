import { HttpError } from "../../lib/errors.js";
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from "../../lib/opaqueToken.js";
import type { AuthService } from "../auth/service.js";
import { assertSeatAvailable } from "./seats.js";
import {
  DuplicateTokenError,
  type CreatedInvite,
  type InviteRole,
  type InviteSummaryRecord,
  type InviteView,
  type MemberView,
  type TeamSummary,
  type TeamsRepository,
  type TeamsService,
} from "./types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function invalidInviteError(): HttpError {
  return new HttpError(400, "Invalid or expired invite");
}

function alreadyMemberError(): HttpError {
  return new HttpError(409, "Already a member");
}

function inviteView(
  invite: Pick<InviteSummaryRecord, "id" | "email" | "role" | "expiresAt">,
): InviteView {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt.toISOString(),
  };
}

export interface TeamsServiceDeps {
  repository: TeamsRepository;
  authService: AuthService;
  inviteTtlDays: number;
}

export function createTeamsService(deps: TeamsServiceDeps): TeamsService {
  return {
    async createTeam(userId, name) {
      const team = await deps.repository.createTeamWithOwner(userId, name);
      return { ...team, role: "owner" };
    },

    listTeams(userId) {
      return deps.repository.listTeamsForUser(userId);
    },

    async getTeam(teamId) {
      const team = await deps.repository.findTeam(teamId);
      if (team === undefined) {
        throw new HttpError(404, "Team not found");
      }
      return team;
    },

    getMembership(teamId, userId) {
      return deps.repository.findMembership(teamId, userId);
    },

    async getMembers(teamId) {
      const memberships = await deps.repository.listMemberships(teamId);
      const users = await Promise.all(
        memberships.map((member) =>
          deps.authService.loadUserById(member.userId),
        ),
      );

      return memberships.flatMap((member, index) => {
        const user = users[index];
        if (user === undefined) return [];
        return [{
          id: member.userId,
          email: user.email,
          role: member.role,
        } satisfies MemberView];
      });
    },

    async changeRole(teamId, userId, role: InviteRole) {
      const member = await deps.repository.findMembership(teamId, userId);
      if (member === undefined) {
        throw new HttpError(404, "Member not found");
      }
      if (member.role === "owner") {
        throw new HttpError(403, "Cannot change the owner");
      }
      await deps.repository.updateRole(teamId, userId, role);
    },

    async removeMember(teamId, userId) {
      const member = await deps.repository.findMembership(teamId, userId);
      if (member === undefined) {
        throw new HttpError(404, "Member not found");
      }
      if (member.role === "owner") {
        throw new HttpError(403, "Cannot remove the owner");
      }
      await deps.repository.removeMembership(teamId, userId);
      await deps.repository.removeUserTeam(userId, teamId);
    },

    async createInvite(teamId, invitedBy, email, role) {
      await assertSeatAvailable(teamId);
      const team = await deps.repository.findTeam(teamId);
      if (team === undefined) {
        throw new HttpError(404, "Team not found");
      }

      const expiresAt = new Date(Date.now() + deps.inviteTtlDays * MS_PER_DAY);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const token = generateOpaqueToken();
        const tokenHash = hashOpaqueToken(token);

        try {
          const created = await deps.repository.createInvite({
            teamId,
            invitedBy,
            email,
            role,
            tokenHash,
            expiresAt,
          });

          return {
            ...inviteView(created),
            link: `rota://invite?token=${encodeURIComponent(token)}`,
          } satisfies CreatedInvite;
        } catch (error) {
          if (error instanceof DuplicateTokenError && attempt < 2) {
            continue;
          }
          if (error instanceof DuplicateTokenError) {
            throw invalidInviteError();
          }
          throw error;
        }
      }

      throw invalidInviteError();
    },

    async listInvites(teamId) {
      const invites = await deps.repository.listInvites(teamId);
      return invites.map(inviteView);
    },

    revokeInvite(teamId, inviteId) {
      return deps.repository.revokeInvite(teamId, inviteId);
    },

    async acceptInvite(userId, email, token) {
      const tokenHash = hashOpaqueToken(token);
      const invite = await deps.repository.findInviteByTokenHash(tokenHash);

      if (
        invite === undefined ||
        invite.usedAt !== null ||
        invite.revokedAt !== null ||
        invite.expiresAt <= new Date()
      ) {
        throw invalidInviteError();
      }

      if (
        invite.email !== null &&
        invite.email.toLowerCase() !== email.trim().toLowerCase()
      ) {
        throw new HttpError(403, "Invalid or expired invite");
      }

      const team = await deps.repository.findTeam(invite.teamId);
      if (team === undefined) {
        throw invalidInviteError();
      }

      const existing = await deps.repository.findMembership(
        invite.teamId,
        userId,
      );
      if (existing !== undefined) {
        throw alreadyMemberError();
      }

      await assertSeatAvailable(invite.teamId);

      const consumed = await deps.repository.consumeInvite(invite.id);
      if (consumed === undefined) {
        throw invalidInviteError();
      }

      try {
        const created = await deps.repository.createMembership(
          consumed.teamId,
          userId,
          consumed.role,
        );
        if (!created) {
          throw alreadyMemberError();
        }
        await deps.repository.addUserTeam(userId, consumed.teamId);
      } catch (error) {
        await deps.repository
          .removeMembership(consumed.teamId, userId)
          .catch(() => undefined);
        await deps.repository.releaseInvite(consumed.id).catch(() => undefined);
        throw error;
      }

      return {
        id: team.id,
        name: team.name,
        role: consumed.role,
      } satisfies TeamSummary;
    },
  };
}
