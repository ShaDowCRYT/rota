import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";

import type { Database } from "../../db/client.js";
import { passwordResetTokens } from "../../db/schema/global.js";
import { isUniqueViolation } from "../../lib/errors.js";
import {
  DuplicateResetTokenError,
  type PasswordResetRepository,
} from "./resetTypes.js";

const columns = {
  id: passwordResetTokens.id,
  userId: passwordResetTokens.userId,
  tokenHash: passwordResetTokens.tokenHash,
  expiresAt: passwordResetTokens.expiresAt,
  usedAt: passwordResetTokens.usedAt,
  createdAt: passwordResetTokens.createdAt,
};

export function createPasswordResetRepository(
  db: Database,
): PasswordResetRepository {
  return {
    async invalidateUnusedForUser(userId) {
      await db
        .update(passwordResetTokens)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(passwordResetTokens.userId, userId),
            isNull(passwordResetTokens.usedAt),
          ),
        );
    },

    async create(userId, tokenHash, expiresAt) {
      try {
        const rows = await db
          .insert(passwordResetTokens)
          .values({ userId, tokenHash, expiresAt })
          .returning(columns);

        const created = rows[0];
        if (created === undefined) {
          throw new Error("password reset token insert returned no row");
        }
        return created;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DuplicateResetTokenError();
        }
        throw error;
      }
    },

    async findByHash(tokenHash) {
      const rows = await db
        .select(columns)
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1);

      return rows[0];
    },

    async consume(id) {
      const rows = await db
        .update(passwordResetTokens)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(passwordResetTokens.id, id),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, sql`now()`),
          ),
        )
        .returning(columns);

      return rows[0];
    },

    async release(id) {
      await db
        .update(passwordResetTokens)
        .set({ usedAt: null })
        .where(
          and(
            eq(passwordResetTokens.id, id),
            isNotNull(passwordResetTokens.usedAt),
          ),
        );
    },
  };
}
