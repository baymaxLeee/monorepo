import { Redis } from "ioredis";

import { getSettings } from "../../bootstrap/config.js";

export interface RedisClientOptions {
  maxRetriesPerRequest?: number;
  connectTimeout?: number;
}

export function createRedisClient(options: RedisClientOptions = {}): Redis {
  const settings = getSettings();
  return new Redis({
    host: settings.redisHost,
    port: settings.redisPort,
    db: settings.redisDb,
    lazyConnect: true,
    maxRetriesPerRequest: options.maxRetriesPerRequest ?? 2,
    ...(options.connectTimeout == null
      ? {}
      : { connectTimeout: options.connectTimeout }),
  });
}

let sharedRedisClient: Redis | null = null;

export function getRedisClient(): Redis {
  sharedRedisClient ??= createRedisClient();
  return sharedRedisClient;
}

export async function closeRedisClient(): Promise<void> {
  const client = sharedRedisClient;
  sharedRedisClient = null;
  if (!client) return;
  await client.quit().catch(() => client.disconnect());
}
