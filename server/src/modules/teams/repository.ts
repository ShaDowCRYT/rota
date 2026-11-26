import { randomUUID } from "node:crypto";

import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";

import type { Database } from "../../db/client.js";
import { invites, userTeams } from "../../db/schema/global.js";
import { memberships, teams } from "../../db/schema/shard.js";
import { getShardFor } from "../../db/shard.js";
import { isUniqueViolation } from "../../lib/errors.js";
import {
  DuplicateTokenError,
  type InviteRecord,
  type InviteRole,
  type InviteSummaryRecord,
  type MemberRecord,
  type MembershipRecord,
  type NewInviteRecord,
  type Role,
  type TeamSummary,
  type TeamsRepository,
} from "./types.js";

const inviteColumns = {
  id: invites.id,
  teamId: invites.teamId,
  invitedBy: invites.invitedBy,
  email: invites.email,
  role: invites.role,
  tokenHash: invites.tokenHash,
  expiresAt: invites.expiresAt,
  usedAt: invites.usedAt,
  revokedAt: invites.revokedAt,
  createdAt: invites.createdAt,
};

const inviteSummaryColumns = {
  id: invites.id,
  teamId: invites.teamId,
  invitedBy: invites.invitedBy,
  email: invites.email,
  role: invites.role,
  expiresAt: invites.expiresAt,
  usedAt: invites.usedAt,
  revokedAt: invites.revokedAt,
  createdAt: invites.createdAt,
};

interface InviteRow {
  id: string;
  teamId: string;
  invitedBy: string;
  email: string | null;
  role: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

type InviteSummaryRow = Omit<InviteRow, "tokenHash">;

function toInvite(row: InviteRow): InviteRecord {
  return { ...row, role: row.role as InviteRole };
}

function toInviteSummary(row: InviteSummaryRow): InviteSummaryRecord {
  return { ...row, role: row.role as InviteRole };
}

export function createTeamsRepository(db: Database): TeamsRepository {
  return {
    async createTeamWithOwner(userId, name) {
      const teamId = randomUUID();
      const shard = getShardFor(teamId);

      await shard.transaction(async (tx) => {
        await tx.insert(teams).values({ id: teamId, name, ownerId: userId });
        await tx.insert(memberships).values({
          teamId,
          userId,
          role: "owner",
        });
      });

      await db
        .insert(userTeams)
        .values({ userId, teamId })
        .onConflictDoNothing();

      return { id: teamId, name };
    },

    async listTeamsForUser(userId) {
      const rows = await db
        .select({ teamId: userTeams.teamId })
        .from(userTeams)
        .where(eq(userTeams.userId, userId));

      const summaries = await Promise.all(
        rows.map(async ({ teamId }) => {
          const shard = getShardFor(teamId);
          const matches = await shard
            .select({
              id: teams.id,
              name: teams.name,
              role: memberships.role,
            })
            .from(memberships)
            .innerJoin(teams, eq(teams.id, memberships.teamId))
            .where(
              and(
                eq(memberships.teamId, teamId),
                eq(memberships.userId, userId),
              ),
            )
            .limit(1);

          return matches[0];
        }),
      );

      return summaries.filter(
        (summary): summary is TeamSummary => summary !== undefined,
      );
    },

    async countOwnedTeams(userId) {
      const rows = await db
        .select({ teamId: userTeams.teamId })
        .from(userTeams)
        .where(eq(userTeams.userId, userId));

      const owned = await Promise.all(
        rows.map(async ({ teamId }) => {
          const shard = getShardFor(teamId);
          const matches = await shard
            .select({ role: memberships.role })
            .from(memberships)
            .where(
              and(
                eq(memberships.teamId, teamId),
                eq(memberships.userId, userId),
                eq(memberships.role, "owner"),
              ),
            )
            .limit(1);

          return matches.length > 0;
        }),
      );

      return owned.filter(Boolean).length;
    },

    async findTeam(teamId) {
      const shard = getShardFor(teamId);
      const rows = await shard
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      return rows[0];
    },

    async findMembership(teamId, userId) {
      const shard = getShardFor(teamId);
      const rows = await shard
        .select({
          teamId: memberships.teamId,
          userId: memberships.userId,
          role: memberships.role,
        })
        .from(memberships)
        .where(
          and(
            eq(memberships.teamId, teamId),
            eq(memberships.userId, userId),
          ),
        )
        .limit(1);

      return rows[0] as MembershipRecord | undefined;
    },

    async createMembership(teamId, userId, role: Role) {
      const shard = getShardFor(teamId);
      const rows = await shard
        .insert(memberships)
        .values({ teamId, userId, role })
        .onConflictDoNothing()
        .returning({ userId: memberships.userId });

      return rows.length > 0;
    },

    async listMemberships(teamId) {
      const shard = getShardFor(teamId);
      const rows = await shard
        .select({ userId: memberships.userId, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.teamId, teamId));

      return rows as MemberRecord[];
    },

    async updateRole(teamId, userId, role: InviteRole) {
      const shard = getShardFor(teamId);
      await shard
        .update(memberships)
        .set({ role })
        .where(
          and(
            eq(memberships.teamId, teamId),
            eq(memberships.userId, userId),
          ),
        );
    },

    async removeMembership(teamId, userId) {
      const shard = getShardFor(teamId);
      await shard
        .delete(memberships)
        .where(
          and(
            eq(memberships.teamId, teamId),
            eq(memberships.userId, userId),
          ),
        );
    },

    async addUserTeam(userId, teamId) {
      await db
        .insert(userTeams)
        .values({ userId, teamId })
        .onConflictDoNothing();
    },

    async removeUserTeam(userId, teamId) {
      await db
        .delete(userTeams)
        .where(
          and(eq(userTeams.userId, userId), eq(userTeams.teamId, teamId)),
        );
    },

    async createInvite(invite: NewInviteRecord) {
      try {
        const rows = await db
          .insert(invites)
          .values(invite)
          .returning(inviteColumns);

        const created = rows[0];
        if (created === undefined) {
          throw new Error("invite insert returned no row");
        }

        return toInvite(created as InviteRow);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DuplicateTokenError();
        }
        throw error;
      }
    },

    async findInviteByTokenHash(tokenHash) {
      const rows = await db
        .select(inviteColumns)
        .from(invites)
        .where(eq(invites.tokenHash, tokenHash))
        .limit(1);

      const found = rows[0];
      return found === undefined ? undefined : toInvite(found as InviteRow);
    },

    async consumeInvite(id) {
      const rows = await db
        .update(invites)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(invites.id, id),
            isNull(invites.usedAt),
            isNull(invites.revokedAt),
            gt(invites.expiresAt, sql`now()`),
          ),
        )
        .returning(inviteColumns);

      const consumed = rows[0];
      return consumed === undefined ? undefined : toInvite(consumed as InviteRow);
    },

    async releaseInvite(id) {
      await db
        .update(invites)
        .set({ usedAt: null })
        .where(and(eq(invites.id, id), isNotNull(invites.usedAt)));
    },

    async listInvites(teamId) {
      const rows = await db
        .select(inviteSummaryColumns)
        .from(invites)
        .where(eq(invites.teamId, teamId))
        .orderBy(desc(invites.createdAt));

      return rows.map((row) => toInviteSummary(row as InviteSummaryRow));
    },

    async revokeInvite(teamId, inviteId) {
      await db
        .update(invites)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(invites.teamId, teamId),
            eq(invites.id, inviteId),
            isNull(invites.revokedAt),
          ),
        );
    },
  };
}
