import { Redis } from "ioredis";

import { getErrorMessage } from "./errors.js";
import { logger } from "./logger.js";

let client: Redis | undefined;

export function getRedis(redisUrl: string): Redis {
  if (client !== undefined) {
    return client;
  }

  const created = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 10_000,
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 200, 2_000),
  });

  created.on("error", (error) => {
    logger.error("redis client error", {
      error: getErrorMessage(error),
    });
  });

  client = created;
  return created;
}

export async function checkRedis(redisUrl: string): Promise<boolean> {
  try {
    await getRedis(redisUrl).ping();
    return true;
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (client === undefined) {
    return;
  }

  const current = client;
  client = undefined;

  if (current.status === "wait" || current.status === "end") {
    current.disconnect();
    return;
  }

  try {
    await current.quit();
  } catch (error) {
    logger.warn("failed to close redis gracefully", {
      error: getErrorMessage(error),
    });
    current.disconnect();
  }
}
