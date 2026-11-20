import { Algorithm, hash, verify } from "@node-rs/argon2";

import type { PasswordService } from "../modules/auth/types.js";

const options = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function createPasswordService(): PasswordService {
  return {
    hash: (password) => hash(password, options),
    verify: (passwordHash, password) => verify(passwordHash, password, options),
  };
}
