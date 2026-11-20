import { HttpError } from "../../lib/errors.js";
import type { AuthRepository, AuthResult, PasswordService, TokenIssuer, AuthUser } from "./types.js";
import { DuplicateEmailError } from "./types.js";

export interface AuthServiceDeps {
  repository: AuthRepository;
  passwords: PasswordService;
  tokens: TokenIssuer;
}

export interface AuthService {
  signup(email: string, password: string): Promise<AuthResult>;
  login(email: string, password: string): Promise<AuthResult>;
  verifyAccessToken(token: string): Promise<string | undefined>;
  loadUserById(id: string): Promise<AuthUser | undefined>;
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  let dummyHashPromise: Promise<string> | undefined;

  const dummyHash = (): Promise<string> => {
    if (dummyHashPromise === undefined) {
      dummyHashPromise = deps.passwords.hash("timing-equalisation-value");
    }
    return dummyHashPromise;
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

      return {
        user: { id: user.id, email: user.email },
        accessToken: await deps.tokens.sign(user.id),
      };
    },

    async login(email, password) {
      const user = await deps.repository.findByEmail(email);
      const storedHash = user?.passwordHash ?? (await dummyHash());
      const passwordMatches = await deps.passwords.verify(storedHash, password);

      if (user === undefined || user.passwordHash === null || !passwordMatches) {
        throw new HttpError(401, "Invalid email or password");
      }

      return {
        user: { id: user.id, email: user.email },
        accessToken: await deps.tokens.sign(user.id),
      };
    },

    verifyAccessToken(token) {
      return deps.tokens.verify(token);
    },

    async loadUserById(id) {
      const user = await deps.repository.findById(id);
      return user === undefined ? undefined : { id: user.id, email: user.email };
    },
  };
}
