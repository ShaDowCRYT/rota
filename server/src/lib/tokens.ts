import { SignJWT, jwtVerify } from "jose";

import type { TokenIssuer } from "../modules/auth/types.js";

export interface TokenConfig {
  secret: string;
  ttlSeconds: number;
}

const issuer = "rota";
const audience = "rota-app";

export function createTokenIssuer(config: TokenConfig): TokenIssuer {
  const key = new TextEncoder().encode(config.secret);

  return {
    async sign(userId) {
      const now = Math.floor(Date.now() / 1000);

      return new SignJWT({})
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(userId)
        .setIssuedAt(now)
        .setExpirationTime(now + config.ttlSeconds)
        .sign(key);
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ["HS256"],
          issuer,
          audience,
        });

        return typeof payload.sub === "string" ? payload.sub : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
