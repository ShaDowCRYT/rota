import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import type { Express } from "express";

import { errorHandler } from "../middleware/errorHandler.js";
import type { RateLimiter, RedisLike } from "../middleware/rateLimit.js";
import type { EmailMessage, EmailSender } from "../providers/email.js";
import type {
  PasswordResetRepository,
  PasswordResetTokenRecord,
} from "../modules/auth/resetTypes.js";
import type { AuthService } from "../modules/auth/service.js";
import type {
  AuthRepository,
  PasswordService,
  RefreshTokenRecord,
  UserRecord,
} from "../modules/auth/types.js";
import { DuplicateEmailError } from "../modules/auth/types.js";
import type {
  InviteRecord,
  InviteRole,
  MemberRecord,
  MembershipRecord,
  NewInviteRecord,
  Role,
  TeamRecord,
  TeamSummary,
  TeamsRepository,
  TeamsService,
} from "../modules/teams/types.js";

export const testTokenConfig = {
  secret: "test-only-secret-that-is-long-enough-for-hs256",
  ttlSeconds: 900,
};

export const testRefreshTtlDays = 30;
export const testResetTtlMinutes = 30;

export function startServer(
  app: Express,
): Promise<{ server: Server; baseUrl: string }> {
  app.use(errorHandler);

  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected the server to bind to a TCP port"));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

export const permissiveLimiter: RateLimiter = {
  async consume() {},
};

export const unusedAuthService: AuthService = {
  async signup() {
    throw new Error("unused in this test");
  },
  async login() {
    throw new Error("unused in this test");
  },
  async refresh() {
    throw new Error("unused in this test");
  },
  async logout() {},
  async logoutAll() {},
  async verifyAccessToken() {
    return undefined;
  },
  async loadUserById() {
    return undefined;
  },
  async loadUserByEmail() {
    return undefined;
  },
  async setPasswordHash() {},
};

export const unusedEmailSender: EmailSender = {
  async send() {},
};

export const unusedPasswordResetRepository: PasswordResetRepository = {
  async invalidateUnusedForUser() {},
  async create() {
    throw new Error("unused in this test");
  },
  async findByHash() {
    return undefined;
  },
  async consume() {
    return undefined;
  },
  async release() {},
};

export const unusedTeamsService: TeamsService = {
  async createTeam() {
    throw new Error("unused in this test");
  },
  async listTeams() {
    return [];
  },
  async getTeam() {
    throw new Error("unused in this test");
  },
  async getMembership() {
    return undefined;
  },
  async getMembers() {
    return [];
  },
  async changeRole() {},
  async removeMember() {},
  async createInvite() {
    throw new Error("unused in this test");
  },
  async listInvites() {
    return [];
  },
  async revokeInvite() {},
  async acceptInvite() {
    throw new Error("unused in this test");
  },
};

export class FakeRedis implements RedisLike {
  private readonly counts = new Map<string, number>();
  private readonly expiries = new Map<string, number>();
  fail = false;
  incrCalls = 0;
  expireCalls = 0;

  async incr(key: string): Promise<number> {
    if (this.fail) throw new Error("redis connection refused");
    this.incrCalls += 1;
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (this.fail) throw new Error("redis connection refused");
    this.expireCalls += 1;
    this.expiries.set(key, seconds);
    return 1;
  }

  async eval(
    _script: string,
    keys: readonly string[],
    args: readonly (string | number)[],
  ): Promise<number> {
    const key = keys[0];
    const seconds = Number(args[0]);
    if (key === undefined || !Number.isInteger(seconds)) {
      throw new Error("invalid eval arguments");
    }

    const count = await this.incr(key);
    if (count === 1) {
      await this.expire(key, seconds);
    }
    return count;
  }

  keys(): string[] {
    return [...this.expiries.keys()];
  }

  expiryFor(key: string): number | undefined {
    return this.expiries.get(key);
  }
}

export class FakeAuthRepository implements AuthRepository {
  readonly byEmail = new Map<string, UserRecord>();
  readonly refreshTokenRecords: RefreshTokenRecord[] = [];

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    return this.byEmail.get(email);
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    return [...this.byEmail.values()].find((user) => user.id === id);
  }

  async createUser(email: string, passwordHash: string): Promise<UserRecord> {
    if (this.byEmail.has(email)) {
      throw new DuplicateEmailError();
    }

    const user = { id: randomUUID(), email, passwordHash };
    this.byEmail.set(email, user);
    return user;
  }

  async createRefreshToken(
    userId: string,
    familyId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<RefreshTokenRecord> {
    const record: RefreshTokenRecord = {
      id: randomUUID(),
      userId,
      familyId,
      tokenHash,
      expiresAt,
      usedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };

    this.refreshTokenRecords.push(record);
    return record;
  }

  async findRefreshTokenByHash(
    tokenHash: string,
  ): Promise<RefreshTokenRecord | undefined> {
    return this.refreshTokenRecords.find(
      (record) => record.tokenHash === tokenHash,
    );
  }

  async consumeRefreshToken(
    id: string,
  ): Promise<RefreshTokenRecord | undefined> {
    const record = this.refreshTokenRecords.find((item) => item.id === id);

    if (
      record === undefined ||
      record.usedAt !== null ||
      record.revokedAt !== null ||
      record.expiresAt <= new Date()
    ) {
      return undefined;
    }

    record.usedAt = new Date();
    return record;
  }

  async revokeFamily(familyId: string): Promise<void> {
    for (const record of this.refreshTokenRecords) {
      if (record.familyId === familyId && record.revokedAt === null) {
        record.revokedAt = new Date();
      }
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    for (const record of this.refreshTokenRecords) {
      if (record.userId === userId && record.revokedAt === null) {
        record.revokedAt = new Date();
      }
    }
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    for (const user of this.byEmail.values()) {
      if (user.id === userId) {
        user.passwordHash = passwordHash;
      }
    }
  }

  async withTransaction<T>(
    work: (repository: AuthRepository) => Promise<T>,
  ): Promise<T> {
    return work(this);
  }
}

export interface CountingPasswordService extends PasswordService {
  verifyCalls: number;
  hashCalls: number;
}

export function createFakePasswords(): CountingPasswordService {
  return {
    verifyCalls: 0,
    hashCalls: 0,
    async hash(password) {
      this.hashCalls += 1;
      return `fake:${password}`;
    },
    async verify(passwordHash, password) {
      this.verifyCalls += 1;
      return passwordHash === `fake:${password}`;
    },
  };
}

export class FakePasswordResetRepository
  implements PasswordResetRepository
{
  readonly tokens = new Map<string, PasswordResetTokenRecord>();

  async invalidateUnusedForUser(userId: string): Promise<void> {
    for (const token of this.tokens.values()) {
      if (token.userId === userId && token.usedAt === null) {
        token.usedAt = new Date();
      }
    }
  }

  async create(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<PasswordResetTokenRecord> {
    const record: PasswordResetTokenRecord = {
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: new Date(),
    };
    this.tokens.set(record.id, record);
    return record;
  }

  async findByHash(
    tokenHash: string,
  ): Promise<PasswordResetTokenRecord | undefined> {
    return [...this.tokens.values()].find(
      (token) => token.tokenHash === tokenHash,
    );
  }

  async consume(id: string): Promise<PasswordResetTokenRecord | undefined> {
    const record = this.tokens.get(id);
    if (
      record === undefined ||
      record.usedAt !== null ||
      record.expiresAt <= new Date()
    ) {
      return undefined;
    }
    record.usedAt = new Date();
    return record;
  }

  async release(id: string): Promise<void> {
    const record = this.tokens.get(id);
    if (record !== undefined) {
      record.usedAt = null;
    }
  }
}

export class FakeEmailSender implements EmailSender {
  readonly messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

export class FakeTeamsRepository implements TeamsRepository {
  readonly teams = new Map<string, TeamRecord>();
  readonly memberships = new Map<string, MembershipRecord>();
  readonly userTeams: Array<{ userId: string; teamId: string }> = [];
  readonly invites = new Map<string, InviteRecord>();

  private membershipKey(teamId: string, userId: string): string {
    return `${teamId}:${userId}`;
  }

  async createTeamWithOwner(userId: string, name: string): Promise<TeamRecord> {
    const team = { id: randomUUID(), name };
    this.teams.set(team.id, team);
    this.memberships.set(this.membershipKey(team.id, userId), {
      teamId: team.id,
      userId,
      role: "owner",
    });
    this.userTeams.push({ userId, teamId: team.id });
    return team;
  }

  async listTeamsForUser(userId: string): Promise<TeamSummary[]> {
    return this.userTeams.flatMap(({ teamId }) => {
      const team = this.teams.get(teamId);
      const membership = this.memberships.get(this.membershipKey(teamId, userId));
      if (team === undefined || membership === undefined) return [];
      return [{ ...team, role: membership.role }];
    });
  }

  async findTeam(teamId: string): Promise<TeamRecord | undefined> {
    return this.teams.get(teamId);
  }

  async findMembership(
    teamId: string,
    userId: string,
  ): Promise<MembershipRecord | undefined> {
    return this.memberships.get(this.membershipKey(teamId, userId));
  }

  async createMembership(
    teamId: string,
    userId: string,
    role: Role,
  ): Promise<boolean> {
    const key = this.membershipKey(teamId, userId);
    if (this.memberships.has(key)) return false;
    this.memberships.set(key, { teamId, userId, role });
    return true;
  }

  async listMemberships(teamId: string): Promise<MemberRecord[]> {
    return [...this.memberships.values()]
      .filter((membership) => membership.teamId === teamId)
      .map(({ userId, role }) => ({ userId, role }));
  }

  async updateRole(
    teamId: string,
    userId: string,
    role: InviteRole,
  ): Promise<void> {
    const membership = this.memberships.get(this.membershipKey(teamId, userId));
    if (membership !== undefined) {
      membership.role = role;
    }
  }

  async removeMembership(teamId: string, userId: string): Promise<void> {
    this.memberships.delete(this.membershipKey(teamId, userId));
  }

  async addUserTeam(userId: string, teamId: string): Promise<void> {
    if (
      !this.userTeams.some(
        (entry) => entry.userId === userId && entry.teamId === teamId,
      )
    ) {
      this.userTeams.push({ userId, teamId });
    }
  }

  async removeUserTeam(userId: string, teamId: string): Promise<void> {
    const index = this.userTeams.findIndex(
      (entry) => entry.userId === userId && entry.teamId === teamId,
    );
    if (index !== -1) {
      this.userTeams.splice(index, 1);
    }
  }

  async createInvite(invite: NewInviteRecord): Promise<InviteRecord> {
    const record: InviteRecord = {
      ...invite,
      id: randomUUID(),
      usedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.invites.set(record.id, record);
    return record;
  }

  async findInviteByTokenHash(
    tokenHash: string,
  ): Promise<InviteRecord | undefined> {
    return [...this.invites.values()].find(
      (invite) => invite.tokenHash === tokenHash,
    );
  }

  async consumeInvite(id: string): Promise<InviteRecord | undefined> {
    const invite = this.invites.get(id);
    if (
      invite === undefined ||
      invite.usedAt !== null ||
      invite.revokedAt !== null ||
      invite.expiresAt <= new Date()
    ) {
      return undefined;
    }
    invite.usedAt = new Date();
    return invite;
  }

  async releaseInvite(id: string): Promise<void> {
    const invite = this.invites.get(id);
    if (invite !== undefined) {
      invite.usedAt = null;
    }
  }

  async listInvites(teamId: string) {
    return [...this.invites.values()]
      .filter((invite) => invite.teamId === teamId)
      .map((invite) => ({
        id: invite.id,
        teamId: invite.teamId,
        invitedBy: invite.invitedBy,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
        usedAt: invite.usedAt,
        revokedAt: invite.revokedAt,
        createdAt: invite.createdAt,
      }));
  }

  async revokeInvite(teamId: string, inviteId: string): Promise<void> {
    const invite = this.invites.get(inviteId);
    if (invite !== undefined && invite.teamId === teamId) {
      invite.revokedAt = new Date();
    }
  }
}
