import { Redis } from "ioredis";

import { getSettings } from "../../bootstrap/config.js";
import { getSql } from "../persistence/index.js";

export type ReadinessReport = {
  ok: boolean;
  boot: "pending" | "ready" | "failed";
  postgres: "up" | "down";
  redis: "up" | "down";
  error?: string;
};

let bootState: ReadinessReport["boot"] = "pending";
let bootError: string | undefined;

export function currentBootState(): ReadinessReport["boot"] {
  return bootState;
}

export function isBootReady(): boolean {
  return bootState === "ready";
}

export function markBootReady(): void {
  bootState = "ready";
  bootError = undefined;
}

export function markBootFailed(error: unknown): void {
  bootState = "failed";
  bootError = error instanceof Error ? error.message : String(error);
}

async function pingRedis(): Promise<boolean> {
  const settings = getSettings();
  const client = new Redis({
    host: settings.redisHost,
    port: settings.redisPort,
    db: settings.redisDb,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  });
  try {
    await client.connect();
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

export async function checkReadiness(): Promise<ReadinessReport> {
  if (bootState === "pending") {
    return { ok: false, boot: "pending", postgres: "down", redis: "down" };
  }
  if (bootState === "failed") {
    return {
      ok: false,
      boot: "failed",
      postgres: "down",
      redis: "down",
      error: bootError,
    };
  }

  let postgres: ReadinessReport["postgres"] = "down";
  let redis: ReadinessReport["redis"] = "down";
  try {
    await getSql()`SELECT 1`;
    postgres = "up";
  } catch {
    postgres = "down";
  }
  if (await pingRedis()) redis = "up";

  return {
    ok: postgres === "up" && redis === "up",
    boot: "ready",
    postgres,
    redis,
  };
}
