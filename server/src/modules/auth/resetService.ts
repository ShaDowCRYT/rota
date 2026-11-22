import { HttpError } from "../../lib/errors.js";
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from "../../lib/opaqueToken.js";
import type { EmailSender } from "../../providers/email.js";
import type { AuthService } from "./service.js";
import type { PasswordService } from "./types.js";
import {
  DuplicateResetTokenError,
  type PasswordResetRepository,
} from "./resetTypes.js";

const MS_PER_MINUTE = 60 * 1000;

function invalidResetError(): HttpError {
  return new HttpError(400, "Invalid or expired token");
}

export interface ResetServiceDeps {
  repository: PasswordResetRepository;
  authService: AuthService;
  passwords: PasswordService;
  emailSender: EmailSender;
  ttlMinutes: number;
}

export interface ResetService {
  requestReset(email: string): Promise<void>;
  reset(token: string, newPassword: string): Promise<void>;
}

export function createResetService(deps: ResetServiceDeps): ResetService {
  return {
    async requestReset(email) {
      let token = generateOpaqueToken();
      let tokenHash = hashOpaqueToken(token);
      const expiresAt = new Date(Date.now() + deps.ttlMinutes * MS_PER_MINUTE);
      const user = await deps.authService.loadUserByEmail(email);

      if (user === undefined) {
        return;
      }

      await deps.repository.invalidateUnusedForUser(user.id);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await deps.repository.create(user.id, tokenHash, expiresAt);
          const link = `rota://reset?token=${encodeURIComponent(token)}`;
          await deps.emailSender.send({
            to: email,
            subject: "Reset your Rota password",
            text: `Use this link to reset your Rota password: ${link}`,
          });
          return;
        } catch (error) {
          if (error instanceof DuplicateResetTokenError && attempt < 2) {
            token = generateOpaqueToken();
            tokenHash = hashOpaqueToken(token);
            continue;
          }
          if (error instanceof DuplicateResetTokenError) {
            throw invalidResetError();
          }
          throw error;
        }
      }
    },

    async reset(token, newPassword) {
      const tokenHash = hashOpaqueToken(token);
      const record = await deps.repository.findByHash(tokenHash);

      if (
        record === undefined ||
        record.usedAt !== null ||
        record.expiresAt <= new Date()
      ) {
        throw invalidResetError();
      }

      const consumed = await deps.repository.consume(record.id);
      if (consumed === undefined) {
        throw invalidResetError();
      }

      try {
        const passwordHash = await deps.passwords.hash(newPassword);
        await deps.authService.setPasswordHash(consumed.userId, passwordHash);
      } catch (error) {
        await deps.repository.release(consumed.id).catch(() => undefined);
        throw error;
      }

      await deps.authService.logoutAll(consumed.userId);
    },
  };
}
