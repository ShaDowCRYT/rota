import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { Database } from "../../db/client.js";
import { refreshTokens, users } from "../../db/schema/global.js";
import { isUniqueViolation } from "../../lib/errors.js";
import {
  DuplicateEmailError,
  type AuthRepository,
  type UserRecord,
} from "./types.js";

type TransactionClient = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbClient = Database | TransactionClient;

const columns = {
  id: users.id,
  email: users.email,
  passwordHash: users.passwordHash,
};

const refreshTokenColumns = {
  id: refreshTokens.id,
  userId: refreshTokens.userId,
  familyId: refreshTokens.familyId,
  tokenHash: refreshTokens.tokenHash,
  expiresAt: refreshTokens.expiresAt,
  usedAt: refreshTokens.usedAt,
  revokedAt: refreshTokens.revokedAt,
  createdAt: refreshTokens.createdAt,
};

export function createAuthRepository(
  db: Database,
  client: DbClient = db,
): AuthRepository {
  return {
    async findByEmail(email) {
      const rows = await client
        .select(columns)
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      return rows[0];
    },

    async findById(id) {
      const rows = await client
        .select(columns)
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      return rows[0];
    },

    async createUser(email, passwordHash): Promise<UserRecord> {
      try {
        const rows = await client
          .insert(users)
          .values({ email, passwordHash })
          .returning(columns);

        const created = rows[0];
        if (created === undefined) {
          throw new Error("user insert returned no row");
        }

        return created;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DuplicateEmailError();
        }
        throw error;
      }
    },

    async createRefreshToken(userId, familyId, tokenHash, expiresAt) {
      const rows = await client
        .insert(refreshTokens)
        .values({ userId, familyId, tokenHash, expiresAt })
        .returning(refreshTokenColumns);

      const created = rows[0];
      if (created === undefined) {
        throw new Error("refresh token insert returned no row");
      }

      return created;
    },

    async findRefreshTokenByHash(tokenHash) {
      const rows = await client
        .select(refreshTokenColumns)
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1);

      return rows[0];
    },

    async consumeRefreshToken(id) {
      const rows = await client
        .update(refreshTokens)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(refreshTokens.id, id),
            isNull(refreshTokens.usedAt),
            isNull(refreshTokens.revokedAt),
            gt(refreshTokens.expiresAt, sql`now()`),
          ),
        )
        .returning(refreshTokenColumns);

      return rows[0];
    },

    async revokeFamily(familyId) {
      await client
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(refreshTokens.familyId, familyId),
            isNull(refreshTokens.revokedAt),
          ),
        );
    },

    async revokeAllForUser(userId) {
      await client
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(refreshTokens.userId, userId),
            isNull(refreshTokens.revokedAt),
          ),
        );
    },

    async updatePasswordHash(userId, passwordHash) {
      await client
        .update(users)
        .set({ passwordHash, updatedAt: sql`now()` })
        .where(eq(users.id, userId));
    },

    withTransaction(work) {
      return db.transaction((tx) => work(createAuthRepository(db, tx)));
    },
  };
}
