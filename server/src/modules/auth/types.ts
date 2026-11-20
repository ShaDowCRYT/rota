export interface AuthUser {
  id: string;
  email: string;
}

export interface UserRecord extends AuthUser {
  passwordHash: string | null;
}

export interface AuthResult {
  user: AuthUser;
  accessToken: string;
}

export interface AuthRepository {
  findByEmail(email: string): Promise<UserRecord | undefined>;
  findById(id: string): Promise<UserRecord | undefined>;
  createUser(email: string, passwordHash: string): Promise<UserRecord>;
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
