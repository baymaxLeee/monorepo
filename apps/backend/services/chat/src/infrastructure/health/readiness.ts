import { getSql } from "../persistence/index.js";

export type ReadinessReport = {
  ok: boolean;
  boot: "pending" | "ready" | "failed";
  postgres: "up" | "down";
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

export async function checkReadiness(): Promise<ReadinessReport> {
  if (bootState !== "ready") {
    return {
      ok: false,
      boot: bootState,
      postgres: "down",
      ...(bootError ? { error: bootError } : {}),
    };
  }

  try {
    await getSql()`SELECT 1`;
    return { ok: true, boot: "ready", postgres: "up" };
  } catch {
    return { ok: false, boot: "ready", postgres: "down" };
  }
}
