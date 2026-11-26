import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import type { Express } from "express";

import type { SqlExecutor, TransactionRunner } from "../db/types.js";
import { createTokenIssuer } from "../lib/tokens.js";
import { errorHandler } from "../middleware/errorHandler.js";
import type { RateLimiter, RedisLike } from "../middleware/rateLimit.js";
import type { EmailMessage, EmailSender } from "../providers/email.js";
import type {
  PasswordResetRepository,
  PasswordResetTokenRecord,
} from "../modules/auth/resetTypes.js";
import type {
  ActivityEventInput,
  ActivityRepository,
  ActivityRow,
  ActivityService,
} from "../modules/activity/types.js";
import type { AuthService } from "../modules/auth/service.js";
import type {
  AuthRepository,
  PasswordService,
  RefreshTokenRecord,
  UserRecord,
} from "../modules/auth/types.js";
import {
  DuplicateEmailError,
  DuplicateGoogleAccountError,
} from "../modules/auth/types.js";
import { createActivityService } from "../modules/activity/service.js";
import { createAuthService } from "../modules/auth/service.js";
import { createShiftsService } from "../modules/shifts/service.js";
import type {
  NewShift,
  ShiftRecord,
  ShiftTimes,
  ShiftUpdateResult,
  ShiftsRepository,
  ShiftsService,
} from "../modules/shifts/types.js";
import { createSwapsService } from "../modules/swaps/service.js";
import { createTeamsService } from "../modules/teams/service.js";
import type {
  DecideOutcome,
  ShiftForSwap,
  NewSwapRequest,
  SwapListFilter,
  SwapRequestRecord,
  SwapStatus,
  SwapsRepository,
  SwapsService,
} from "../modules/swaps/types.js";
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
  async googleSignIn() {
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

export const unusedActivityService: ActivityService = {
  async list() {
    return { items: [], nextCursor: null };
  },
  async record() {},
};

export const unusedShiftsService: ShiftsService = {
  async create() {
    throw new Error("unused in this test");
  },
  async list() {
    return [];
  },
  async update() {
    throw new Error("unused in this test");
  },
  async remove() {},
};

export const unusedSwapsService: SwapsService = {
  async request() {
    throw new Error("unused in this test");
  },
  async list() {
    return [];
  },
  async decide() {
    throw new Error("unused in this test");
  },
  async cancel() {},
};

export const fakeExecutor: SqlExecutor = {
  async execute() {
    return { rows: [] };
  },
};

export const testTransactionRunner: TransactionRunner = (_teamId, work) =>
  work(fakeExecutor);

interface FakeActivityRow extends ActivityRow {
  teamId: string;
}

const fakeTimestampPattern =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

export class FakeActivityRepository implements ActivityRepository {
  readonly rows: FakeActivityRow[] = [];
  private sequence = 0;

  async append(_executor: SqlExecutor, event: ActivityEventInput): Promise<void> {
    this.sequence += 1;
    const micros = String(this.sequence).padStart(6, "0");
    const createdAtText = `2026-01-01 00:00:00.${micros}+00`;
    this.rows.push({
      id: randomUUID(),
      teamId: event.teamId,
      type: event.type,
      actorId: event.actorId,
      payload: event.payload,
      createdAtText,
      createdAtDate: new Date(`2026-01-01T00:00:00.${micros}Z`),
    });
  }

  async list(
    teamId: string,
    cursorTimeText: string | undefined,
    cursorId: string | undefined,
    limit: number,
  ): Promise<{ rows: ActivityRow[]; hasMore: boolean }> {
    let rows = this.rows.filter((row) => row.teamId === teamId);

    if (cursorTimeText !== undefined && cursorId !== undefined) {
      rows = rows.filter(
        (row) =>
          row.createdAtText < cursorTimeText ||
          (row.createdAtText === cursorTimeText && row.id < cursorId),
      );
    }

    rows.sort(
      (left, right) =>
        right.createdAtText.localeCompare(left.createdAtText) ||
        right.id.localeCompare(left.id),
    );

    return {
      rows: rows.slice(0, limit),
      hasMore: rows.length > limit,
    };
  }

  async cursorTimeIsValid(_teamId: string, text: string): Promise<boolean> {
    return fakeTimestampPattern.test(text);
  }
}

export class FakeShiftsRepository implements ShiftsRepository {
  readonly shifts = new Map<string, ShiftRecord>();
  pendingSwapIdToCancel: string | null = null;
  swapsRepository?: FakeSwapsRepository;

  async lockAssignee(): Promise<void> {}

  async findOverlap(
    _executor: SqlExecutor,
    input: Parameters<ShiftsRepository["findOverlap"]>[1],
  ): Promise<boolean> {
    return [...this.shifts.values()].some(
      (shift) =>
        shift.teamId === input.teamId &&
        shift.assigneeId === input.assigneeId &&
        shift.id !== input.excludeShiftId &&
        shift.startsAt < input.endsAt &&
        shift.endsAt > input.startsAt,
    );
  }

  async create(_executor: SqlExecutor, input: NewShift): Promise<ShiftRecord> {
    const now = new Date();
    const shift: ShiftRecord = {
      id: randomUUID(),
      teamId: input.teamId,
      assigneeId: input.assigneeId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.shifts.set(shift.id, shift);
    return shift;
  }

  async find(teamId: string, shiftId: string): Promise<ShiftRecord | undefined> {
    const shift = this.shifts.get(shiftId);
    return shift?.teamId === teamId ? shift : undefined;
  }

  async list(filter: Parameters<ShiftsRepository["list"]>[0]): Promise<ShiftRecord[]> {
    return [...this.shifts.values()]
      .filter(
        (shift) =>
          shift.teamId === filter.teamId &&
          shift.startsAt >= filter.from &&
          shift.startsAt < filter.to &&
          (filter.assigneeId === undefined || shift.assigneeId === filter.assigneeId),
      )
      .sort(
        (left, right) =>
          left.startsAt.getTime() - right.startsAt.getTime() ||
          left.id.localeCompare(right.id),
      )
      .slice(0, 500);
  }

  async update(
    _executor: SqlExecutor,
    teamId: string,
    shiftId: string,
    input: ShiftTimes,
  ): Promise<ShiftUpdateResult | undefined> {
    const current = await this.find(teamId, shiftId);
    if (current === undefined) {
      return undefined;
    }

    let cancelledSwapId: string | null = null;
    if (current.assigneeId !== input.assigneeId) {
      cancelledSwapId = this.pendingSwapIdToCancel;
      this.pendingSwapIdToCancel = null;
      const request =
        cancelledSwapId === null
          ? undefined
          : this.swapsRepository?.requests.get(cancelledSwapId);
      if (cancelledSwapId !== null && request !== undefined) {
        this.swapsRepository?.requests.set(cancelledSwapId, {
          ...request,
          status: "cancelled",
          decidedAt: new Date(),
        });
      }
    }

    const updated: ShiftRecord = {
      ...current,
      assigneeId: input.assigneeId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      updatedAt: new Date(),
    };
    this.shifts.set(shiftId, updated);
    return { shift: updated, cancelledSwapId };
  }

  async remove(
    _executor: SqlExecutor,
    teamId: string,
    shiftId: string,
  ): Promise<boolean> {
    const shift = await this.find(teamId, shiftId);
    if (shift === undefined) {
      return false;
    }
    this.shifts.delete(shiftId);
    return true;
  }
}

export class FakeSwapsRepository implements SwapsRepository {
  readonly requests = new Map<string, SwapRequestRecord>();

  constructor(private readonly shiftsRepository: FakeShiftsRepository) {}

  async findShiftForSwap(
    teamId: string,
    shiftId: string,
  ): Promise<ShiftForSwap | undefined> {
    const shift = await this.shiftsRepository.find(teamId, shiftId);
    if (shift === undefined) {
      return undefined;
    }
    return {
      id: shift.id,
      assigneeId: shift.assigneeId,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
    };
  }

  async lockAssignee(): Promise<void> {}

  findOverlap(
    executor: SqlExecutor,
    teamId: string,
    assigneeId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<boolean> {
    return this.shiftsRepository.findOverlap(executor, {
      teamId,
      assigneeId,
      startsAt,
      endsAt,
    });
  }

  async create(
    _executor: SqlExecutor,
    input: NewSwapRequest,
  ): Promise<SwapRequestRecord> {
    const pending = [...this.requests.values()].some(
      (request) => request.shiftId === input.shiftId && request.status === "pending",
    );
    if (pending) {
      throw Object.assign(new Error("duplicate pending swap"), {
        cause: { code: "23505" },
      });
    }

    const request: SwapRequestRecord = {
      id: randomUUID(),
      teamId: input.teamId,
      shiftId: input.shiftId,
      requesterId: input.requesterId,
      targetId: input.targetId,
      status: "pending",
      decidedBy: null,
      createdAt: new Date(),
      decidedAt: null,
    };
    this.requests.set(request.id, request);
    return request;
  }

  async find(
    teamId: string,
    requestId: string,
  ): Promise<SwapRequestRecord | undefined> {
    const request = this.requests.get(requestId);
    return request?.teamId === teamId ? request : undefined;
  }

  async list(filter: SwapListFilter): Promise<SwapRequestRecord[]> {
    return [...this.requests.values()]
      .filter(
        (request) =>
          request.teamId === filter.teamId &&
          (filter.status === undefined || request.status === filter.status) &&
          (filter.isManager ||
            request.requesterId === filter.viewerId ||
            request.targetId === filter.viewerId),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id),
      );
  }

  async decide(
    _executor: SqlExecutor,
    teamId: string,
    requestId: string,
    status: Exclude<SwapStatus, "pending">,
    decidedBy: string,
    assigneeId?: string,
  ): Promise<DecideOutcome> {
    const request = await this.find(teamId, requestId);
    if (request === undefined) {
      return { kind: "not_found" };
    }
    if (request.status !== "pending") {
      return { kind: "already_decided" };
    }

    const shift = await this.shiftsRepository.find(teamId, request.shiftId);
    if (status === "approved") {
      if (assigneeId === undefined || shift === undefined) {
        return { kind: "not_found" };
      }
      if (shift.assigneeId !== request.requesterId) {
        return { kind: "assignee_changed" };
      }
      if (
        await this.findOverlap(
          fakeExecutor,
          teamId,
          assigneeId,
          shift.startsAt,
          shift.endsAt,
        )
      ) {
        return { kind: "overlap" };
      }
    }

    const updated: SwapRequestRecord = {
      ...request,
      status,
      decidedBy,
      decidedAt: new Date(),
    };
    this.requests.set(updated.id, updated);

    let updatedShift: ShiftRecord | undefined;
    if (status === "approved" && assigneeId !== undefined && shift !== undefined) {
      updatedShift = { ...shift, assigneeId, updatedAt: new Date() };
      this.shiftsRepository.shifts.set(shift.id, updatedShift);
    }

    return { kind: "decided", request: updated, shift: updatedShift };
  }
}

export function createSchedulingHarness(
  teamsService: TeamsService,
  now: () => Date = () => new Date(),
) {
  const activityRepository = new FakeActivityRepository();
  const shiftsRepository = new FakeShiftsRepository();
  const swapsRepository = new FakeSwapsRepository(shiftsRepository);
  shiftsRepository.swapsRepository = swapsRepository;
  const activityService = createActivityService(activityRepository);

  return {
    activityRepository,
    shiftsRepository,
    swapsRepository,
    activityService,
    shiftsService: createShiftsService({
      repository: shiftsRepository,
      activity: activityService,
      teamsService,
      transactions: testTransactionRunner,
      now,
    }),
    swapsService: createSwapsService({
      repository: swapsRepository,
      activity: activityService,
      teamsService,
      transactions: testTransactionRunner,
      now,
    }),
  };
}

export async function setupScheduling(
  now: () => Date = () => new Date(),
) {
  const authRepository = new FakeAuthRepository();
  const teamsRepository = new FakeTeamsRepository();
  const authService = createAuthService({
    repository: authRepository,
    passwords: createFakePasswords(),
    tokens: createTokenIssuer(testTokenConfig),
    refreshTtlDays: testRefreshTtlDays,
  });
  const teamsService = createTeamsService({
    repository: teamsRepository,
    authService,
    inviteTtlDays: 7,
  });
  const harness = createSchedulingHarness(teamsService, now);

  const owner = await authRepository.createUser("owner@test.local", "fake:owner");
  const manager = await authRepository.createUser("manager@test.local", "fake:manager");
  const staff = await authRepository.createUser("staff@test.local", "fake:staff");
  const target = await authRepository.createUser("target@test.local", "fake:target");
  const nonMember = await authRepository.createUser("outside@test.local", "fake:outside");

  const team = await teamsService.createTeam(owner.id, "Team A");
  await teamsRepository.createMembership(team.id, manager.id, "manager");
  await teamsRepository.createMembership(team.id, staff.id, "staff");
  await teamsRepository.createMembership(team.id, target.id, "staff");
  const otherTeam = await teamsService.createTeam(nonMember.id, "Team B");

  return {
    ...harness,
    authRepository,
    teamsRepository,
    teamsService,
    users: { owner, manager, staff, target, nonMember },
    team,
    otherTeam,
  };
}

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
  googleDuplicateAfterCreate = 0;
  googleDuplicateAfterLink = 0;

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    return this.byEmail.get(email);
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    return [...this.byEmail.values()].find((user) => user.id === id);
  }

  async findByGoogleSub(googleSub: string): Promise<UserRecord | undefined> {
    return [...this.byEmail.values()].find(
      (user) => user.googleSub === googleSub,
    );
  }

  async createUser(email: string, passwordHash: string): Promise<UserRecord> {
    if (this.byEmail.has(email)) {
      throw new DuplicateEmailError();
    }

    const user = { id: randomUUID(), email, passwordHash, googleSub: null };
    this.byEmail.set(email, user);
    return user;
  }

  async createGoogleUser(email: string, googleSub: string): Promise<UserRecord> {
    if (
      this.byEmail.has(email) ||
      (await this.findByGoogleSub(googleSub)) !== undefined
    ) {
      throw new DuplicateGoogleAccountError();
    }

    const user = { id: randomUUID(), email, passwordHash: null, googleSub };
    this.byEmail.set(email, user);

    if (this.googleDuplicateAfterCreate > 0) {
      this.googleDuplicateAfterCreate -= 1;
      throw new DuplicateGoogleAccountError();
    }

    return user;
  }

  async linkGoogleAccount(userId: string, googleSub: string): Promise<UserRecord> {
    const user = await this.findById(userId);
    if (user === undefined) {
      throw new DuplicateGoogleAccountError();
    }

    if (
      user.googleSub !== null &&
      user.googleSub !== googleSub
    ) {
      throw new DuplicateGoogleAccountError();
    }

    if (
      (await this.findByGoogleSub(googleSub)) !== undefined &&
      user.googleSub !== googleSub
    ) {
      throw new DuplicateGoogleAccountError();
    }

    user.googleSub = googleSub;
    user.passwordHash = null;
    await this.revokeAllForUser(userId);

    if (this.googleDuplicateAfterLink > 0) {
      this.googleDuplicateAfterLink -= 1;
      throw new DuplicateGoogleAccountError();
    }

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

  async countOwnedTeams(userId: string): Promise<number> {
    return [...this.memberships.values()].filter(
      (membership) => membership.userId === userId && membership.role === "owner",
    ).length;
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
