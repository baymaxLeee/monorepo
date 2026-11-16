import { getWorkerSettings } from "../../config/worker.js";
import { getSql } from "../persistence/index.js";

export type ReadinessReport = {
  ok: boolean;
  boot: "pending" | "ready" | "stopping" | "failed";
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

export function markBootStopping(): void {
  bootState = "stopping";
  bootError = undefined;
}

export function markWorkflowWorldStarted(): void {
  workflowWorldStarted = true;
}

export async function checkReadiness(): Promise<ReadinessReport> {
  const workflowConfigured = Boolean(getWorkerSettings().workflowTargetWorld);
  if (bootState === "pending" || bootState === "stopping") {
    return {
      ok: false,
      boot: bootState,
      postgres: "down",
      workflowWorld: workflowConfigured ? "down" : "skipped",
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

  const workflowWorld = workflowConfigured ? (workflowWorldStarted ? "up" : "down") : "skipped";

  return {
    ok: postgres === "up" && (workflowWorld === "up" || workflowWorld === "skipped"),
    boot: "ready",
    postgres,
    workflowWorld,
  };
}
