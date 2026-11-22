export interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export class DuplicateResetTokenError extends Error {
  constructor() {
    super("duplicate reset token");
    this.name = "DuplicateResetTokenError";
  }
}

export interface PasswordResetRepository {
  invalidateUnusedForUser(userId: string): Promise<void>;
  create(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<PasswordResetTokenRecord>;
  findByHash(
    tokenHash: string,
  ): Promise<PasswordResetTokenRecord | undefined>;
  consume(id: string): Promise<PasswordResetTokenRecord | undefined>;
  release(id: string): Promise<void>;
}
