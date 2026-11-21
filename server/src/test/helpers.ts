import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import type { Express } from "express";

import { errorHandler } from "../middleware/errorHandler.js";
import type { RateLimiter, RedisLike } from "../middleware/rateLimit.js";
import type { AuthService } from "../modules/auth/service.js";
import type {
  AuthRepository,
  PasswordService,
  RefreshTokenRecord,
  UserRecord,
} from "../modules/auth/types.js";
import { DuplicateEmailError } from "../modules/auth/types.js";

export const testTokenConfig = {
  secret: "test-only-secret-that-is-long-enough-for-hs256",
  ttlSeconds: 900,
};

export const testRefreshTtlDays = 30;

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
