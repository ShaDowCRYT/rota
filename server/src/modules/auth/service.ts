import { randomUUID } from "node:crypto";

import { HttpError } from "../../lib/errors.js";
import {
  generateRefreshToken,
  hashRefreshToken,
} from "../../lib/refreshToken.js";
import type {
  AuthRepository,
  AuthResult,
  AuthUser,
  PasswordService,
  TokenIssuer,
  TokenPair,
} from "./types.js";
import { DuplicateEmailError } from "./types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function invalidRefreshError(): HttpError {
  return new HttpError(401, "Invalid or expired token");
}

export interface AuthServiceDeps {
  repository: AuthRepository;
  passwords: PasswordService;
  tokens: TokenIssuer;
  refreshTtlDays: number;
}

export interface AuthService {
  signup(email: string, password: string): Promise<AuthResult>;
  login(email: string, password: string): Promise<AuthResult>;
  refresh(token: string): Promise<TokenPair>;
  logout(token: string): Promise<void>;
  logoutAll(userId: string): Promise<void>;
  verifyAccessToken(token: string): Promise<string | undefined>;
  loadUserById(id: string): Promise<AuthUser | undefined>;
  loadUserByEmail(email: string): Promise<AuthUser | undefined>;
  setPasswordHash(userId: string, passwordHash: string): Promise<void>;
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  let dummyHashPromise: Promise<string> | undefined;

  const dummyHash = (): Promise<string> => {
    if (dummyHashPromise === undefined) {
      dummyHashPromise = deps.passwords.hash("timing-equalisation-value");
    }
    return dummyHashPromise;
  };

  const createRefreshToken = async (
    repository: AuthRepository,
    userId: string,
    familyId: string,
  ): Promise<string> => {
    const refreshToken = generateRefreshToken();
    const tokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + deps.refreshTtlDays * MS_PER_DAY);

    await repository.createRefreshToken(userId, familyId, tokenHash, expiresAt);
    return refreshToken;
  };

  const issueAuthResult = async (user: AuthUser): Promise<AuthResult> => {
    const familyId = randomUUID();

    return {
      user,
      accessToken: await deps.tokens.sign(user.id),
      refreshToken: await createRefreshToken(
        deps.repository,
        user.id,
        familyId,
      ),
    };
  };

  return {
    async signup(email, password) {
      const passwordHash = await deps.passwords.hash(password);

      let user;
      try {
        user = await deps.repository.createUser(email, passwordHash);
      } catch (error) {
        if (error instanceof DuplicateEmailError) {
          throw new HttpError(409, "Email already in use");
        }
        throw error;
      }

      return issueAuthResult({ id: user.id, email: user.email });
    },

    async login(email, password) {
      const user = await deps.repository.findByEmail(email);
      const storedHash = user?.passwordHash ?? (await dummyHash());
      const passwordMatches = await deps.passwords.verify(storedHash, password);

      if (user === undefined || user.passwordHash === null || !passwordMatches) {
        throw new HttpError(401, "Invalid email or password");
      }

      return issueAuthResult({ id: user.id, email: user.email });
    },

    async refresh(token) {
      const tokenHash = hashRefreshToken(token);
      const record = await deps.repository.findRefreshTokenByHash(tokenHash);

      if (
        record === undefined ||
        record.revokedAt !== null ||
        record.expiresAt <= new Date()
      ) {
        throw invalidRefreshError();
      }

      const outcome = await deps.repository.withTransaction(async (repository) => {
        const consumed = await repository.consumeRefreshToken(record.id);
        if (consumed === undefined) {
          return { kind: "reuse" } as const;
        }

        const user = await repository.findById(consumed.userId);
        if (user === undefined) {
          return { kind: "missing-user", familyId: consumed.familyId } as const;
        }

        const refreshToken = await createRefreshToken(
          repository,
          consumed.userId,
          consumed.familyId,
        );

        return {
          kind: "success" as const,
          userId: consumed.userId,
          refreshToken,
        };
      });

      if (outcome.kind === "reuse") {
        await deps.repository.revokeFamily(record.familyId);
        throw invalidRefreshError();
      }

      if (outcome.kind === "missing-user") {
        await deps.repository.revokeFamily(outcome.familyId);
        throw invalidRefreshError();
      }

      return {
        accessToken: await deps.tokens.sign(outcome.userId),
        refreshToken: outcome.refreshToken,
      };
    },

    async logout(token) {
      const tokenHash = hashRefreshToken(token);
      const record = await deps.repository.findRefreshTokenByHash(tokenHash);

      if (record !== undefined) {
        await deps.repository.revokeFamily(record.familyId);
      }
    },

    async logoutAll(userId) {
      await deps.repository.revokeAllForUser(userId);
    },

    verifyAccessToken(token) {
      return deps.tokens.verify(token);
    },

    async loadUserById(id) {
      const user = await deps.repository.findById(id);
      return user === undefined ? undefined : { id: user.id, email: user.email };
    },

    async loadUserByEmail(email) {
      const user = await deps.repository.findByEmail(email);
      return user === undefined ? undefined : { id: user.id, email: user.email };
    },

    setPasswordHash(userId, passwordHash) {
      return deps.repository.updatePasswordHash(userId, passwordHash);
    },
  };
}
