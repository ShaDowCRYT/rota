export interface AuthUser {
  id: string;
  email: string;
}

export interface UserRecord extends AuthUser {
  passwordHash: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends TokenPair {
  user: AuthUser;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface AuthRepository {
  findByEmail(email: string): Promise<UserRecord | undefined>;
  findById(id: string): Promise<UserRecord | undefined>;
  createUser(email: string, passwordHash: string): Promise<UserRecord>;
  createRefreshToken(
    userId: string,
    familyId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<RefreshTokenRecord>;
  findRefreshTokenByHash(
    tokenHash: string,
  ): Promise<RefreshTokenRecord | undefined>;
  consumeRefreshToken(id: string): Promise<RefreshTokenRecord | undefined>;
  revokeFamily(familyId: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  withTransaction<T>(
    work: (repository: AuthRepository) => Promise<T>,
  ): Promise<T>;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("duplicate email");
    this.name = "DuplicateEmailError";
  }
}

export interface PasswordService {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

export interface TokenIssuer {
  sign(userId: string): Promise<string>;
  verify(token: string): Promise<string | undefined>;
}
