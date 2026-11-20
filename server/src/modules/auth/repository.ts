import { eq } from "drizzle-orm";

import { db } from "../../db/client.js";
import { users } from "../../db/schema/global.js";
import {
  DuplicateEmailError,
  type AuthRepository,
  type UserRecord,
} from "./types.js";

const columns = {
  id: users.id,
  email: users.email,
  passwordHash: users.passwordHash,
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export function createAuthRepository(): AuthRepository {
  return {
    async findByEmail(email) {
      const rows = await db
        .select(columns)
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      return rows[0];
    },

    async findById(id) {
      const rows = await db
        .select(columns)
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      return rows[0];
    },

    async createUser(email, passwordHash): Promise<UserRecord> {
      try {
        const rows = await db
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
  };
}
