import { jwtVerify, type JWTVerifyGetKey } from "jose";

import { HttpError } from "../../lib/errors.js";
import type { AuthService } from "./service.js";
import type { AuthResult, GoogleIdentity } from "./types.js";

const issuers = ["accounts.google.com", "https://accounts.google.com"];

export interface GoogleSignInService {
  signIn(idToken: string): Promise<AuthResult>;
}

export interface GoogleSignInServiceDeps {
  authService: AuthService;
  audience?: string;
  jwks?: JWTVerifyGetKey;
}

function invalidSignInError(): HttpError {
  return new HttpError(401, "Invalid Google sign-in");
}

function unavailableError(): HttpError {
  return new HttpError(503, "Google sign-in is not available");
}

async function verifyGoogleIdToken(
  idToken: string,
  audience: string,
  jwks: JWTVerifyGetKey,
): Promise<GoogleIdentity | undefined> {
  try {
    const { payload } = await jwtVerify(idToken, jwks, {
      algorithms: ["RS256"],
      audience,
      issuer: issuers,
      requiredClaims: ["sub", "exp", "email", "email_verified"],
    });

    if (
      typeof payload.sub !== "string" ||
      payload.sub.length === 0 ||
      typeof payload.email !== "string" ||
      payload.email.trim().length === 0 ||
      payload.email_verified !== true
    ) {
      return undefined;
    }

    return {
      googleSub: payload.sub,
      email: payload.email.trim().toLowerCase(),
    };
  } catch {
    return undefined;
  }
}

export function createGoogleSignInService(
  deps: GoogleSignInServiceDeps,
): GoogleSignInService {
  return {
    async signIn(idToken) {
      const audience = deps.audience?.trim();
      if (audience === undefined || audience.length === 0 || deps.jwks === undefined) {
        throw unavailableError();
      }

      const identity = await verifyGoogleIdToken(idToken, audience, deps.jwks);
      if (identity === undefined) {
        throw invalidSignInError();
      }

      const result = await deps.authService.googleSignIn(identity);
      return result;
    },
  };
}
