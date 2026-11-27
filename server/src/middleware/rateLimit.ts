import { createHash } from "node:crypto";

import type { Request, RequestHandler } from "express";

import { getErrorMessage, HttpError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export interface RedisLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  eval(
    script: string,
    keys: readonly string[],
    args: readonly (string | number)[],
  ): Promise<number>;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<void>;
}

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  key: (req: Request) => string;
}

const consumeScript = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

export function createRedisFixedWindowLimiter(redis: RedisLike): RateLimiter {
  return {
    async consume(key, limit, windowSeconds) {
      let count: number;

      try {
        count = await redis.eval(consumeScript, [key], [windowSeconds]);
      } catch (error) {
        logger.error("redis rate limit check failed", {
          error: getErrorMessage(error),
        });
        throw new HttpError(503, "Service unavailable");
      }

      if (count > limit) {
        throw new HttpError(429, "Too many requests", {
          "Retry-After": String(windowSeconds),
        });
      }
    },
  };
}

export function rateLimit(
  limiter: RateLimiter,
  options: RateLimitOptions,
): RequestHandler {
  return async (req, _res, next) => {
    try {
      await limiter.consume(
        options.key(req),
        options.limit,
        options.windowSeconds,
      );
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function emailRateKey(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
}

function requestIp(req: Request): string {
  return req.ip ?? "unknown";
}

export function signupRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 5,
    windowSeconds: 3600,
    key: (req) => `rl:signup:ip:${requestIp(req)}`,
  });
}

export function loginIpRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 10,
    windowSeconds: 900,
    key: (req) => `rl:login:ip:${requestIp(req)}`,
  });
}

export function refreshRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 60,
    windowSeconds: 900,
    key: (req) => `rl:refresh:ip:${requestIp(req)}`,
  });
}

export function googleRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 20,
    windowSeconds: 900,
    key: (req) => `rl:google:ip:${requestIp(req)}`,
  });
}

export function loginEmailRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 5,
    windowSeconds: 900,
    key: (req) => {
      const body: unknown = req.body;
      const email =
        typeof body === "object" && body !== null && "email" in body && typeof body.email === "string"
          ? body.email
          : "";
      return `rl:login:email:${emailRateKey(email)}`;
    },
  });
}

export function inviteCreateRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 30,
    windowSeconds: 3600,
    key: (req) => `rl:invite:create:user:${req.user?.id ?? "unknown"}`,
  });
}

export function inviteAcceptRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 20,
    windowSeconds: 900,
    key: (req) => `rl:invite:accept:ip:${requestIp(req)}`,
  });
}

export function createTeamRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 10,
    windowSeconds: 3600,
    key: (req) => `rl:team:create:user:${req.user?.id ?? "unknown"}`,
  });
}

export function forgotIpRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 5,
    windowSeconds: 3600,
    key: (req) => `rl:forgot:ip:${requestIp(req)}`,
  });
}

export function forgotEmailRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 3,
    windowSeconds: 3600,
    key: (req) => {
      const body: unknown = req.body;
      const email =
        typeof body === "object" && body !== null && "email" in body && typeof body.email === "string"
          ? body.email
          : "";
      return `rl:forgot:email:${emailRateKey(email)}`;
    },
  });
}

export function resetRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 10,
    windowSeconds: 900,
    key: (req) => `rl:reset:ip:${requestIp(req)}`,
  });
}

export function activityFeedRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 60,
    windowSeconds: 900,
    key: (req) => `rl:activity:user:${req.user?.id ?? "unknown"}`,
  });
}

export function shiftListRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 120,
    windowSeconds: 900,
    key: (req) => `rl:shifts:user:${req.user?.id ?? "unknown"}`,
  });
}

export function swapListRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 120,
    windowSeconds: 900,
    key: (req) => `rl:swaps:user:${req.user?.id ?? "unknown"}`,
  });
}

export function billingQuoteRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 30,
    windowSeconds: 900,
    key: (req) => `rl:billing:quote:user:${req.user?.id ?? "unknown"}`,
  });
}

export function billingCheckoutRateLimit(limiter: RateLimiter): RequestHandler {
  return rateLimit(limiter, {
    limit: 10,
    windowSeconds: 3600,
    key: (req) => `rl:billing:checkout:user:${req.user?.id ?? "unknown"}`,
  });
}

export function billingWebhookRateLimit(limiter: RateLimiter): RequestHandler {
  return async (req, _res, next) => {
    try {
      await limiter.consume(
        `rl:billing:webhook:ip:${requestIp(req)}`,
        600,
        900,
      );
      next();
    } catch (error) {
      if (error instanceof HttpError && error.status === 503) {
        logger.warn("billing webhook rate limit check unavailable; allowing request", {
          error: getErrorMessage(error),
        });
        next();
        return;
      }
      next(error);
    }
  };
}
