import { createHash } from "node:crypto";

import type { Request, RequestHandler } from "express";

import { getErrorMessage, HttpError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export interface RedisLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<void>;
}

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  key: (req: Request) => string;
}

export function createRedisFixedWindowLimiter(redis: RedisLike): RateLimiter {
  return {
    async consume(key, limit, windowSeconds) {
      let count: number;
      let expirySet = true;

      try {
        count = await redis.incr(key);
        if (count === 1) {
          expirySet = (await redis.expire(key, windowSeconds)) === 1;
        }
      } catch (error) {
        logger.error("redis rate limit check failed", {
          error: getErrorMessage(error),
        });
        throw new HttpError(503, "Service unavailable");
      }

      if (!expirySet) {
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
