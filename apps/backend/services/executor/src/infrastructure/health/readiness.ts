import { getSql } from "../persistence/index.js";

export type ReadinessReport = {
  ok: boolean;
  boot: "pending" | "ready" | "failed";
  postgres: "up" | "down";
  workflowWorld: "up" | "down" | "skipped";
  error?: string;
};

let bootState: ReadinessReport["boot"] = "pending";
let bootError: string | undefined;
let workflowWorldStarted = false;

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

export function markWorkflowWorldStarted(): void {
  workflowWorldStarted = true;
}

export async function checkReadiness(): Promise<ReadinessReport> {
  if (bootState === "pending") {
    return {
      ok: false,
      boot: "pending",
      postgres: "down",
      workflowWorld: process.env.WORKFLOW_TARGET_WORLD ? "down" : "skipped",
    };
  }
  if (bootState === "failed") {
    return {
      ok: false,
      boot: "failed",
      postgres: "down",
      workflowWorld: "down",
      error: bootError,
    };
  }

  let postgres: ReadinessReport["postgres"] = "down";
  try {
    await getSql()`SELECT 1`;
    postgres = "up";
  } catch {
    postgres = "down";
  }

  const workflowWorld = process.env.WORKFLOW_TARGET_WORLD
    ? workflowWorldStarted
      ? "up"
      : "down"
    : "skipped";

  return {
    ok: postgres === "up" && (workflowWorld === "up" || workflowWorld === "skipped"),
    boot: "ready",
    postgres,
    workflowWorld,
  };
}
