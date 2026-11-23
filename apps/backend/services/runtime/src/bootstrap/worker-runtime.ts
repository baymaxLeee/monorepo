import { getWorld } from "workflow/runtime";

import { shutdownOpenTelemetry } from "#runtime/foundation";

import {
  reconcileTaskCleanup,
  startTaskCleanupRecovery,
  stopTaskCleanupRecovery,
} from "../application/tasks/cleanup.js";
import {
  reconcilePendingTasks,
  startPendingTaskRecovery,
  stopPendingTaskRecovery,
} from "../application/tasks/service.js";
import { getWorkerSettings } from "../config/worker.js";
import {
  markBootFailed,
  markBootReady,
  markBootStopping,
  markWorkflowWorldStarted,
} from "../infrastructure/health/worker-readiness.js";
import { logger } from "../infrastructure/observability/worker-logger.js";
import { closeSql, getSql } from "../infrastructure/persistence/index.js";

let workerBootstrap: Promise<void> | undefined;
let workerStopping = false;

async function runWorkerBootstrap(): Promise<void> {
  try {
    const settings = getWorkerSettings();
    await getSql()`SELECT 1`;
    if (settings.workflowTargetWorld) {
      await (await getWorld()).start?.();
      markWorkflowWorldStarted();
    }
    await reconcilePendingTasks();
    startPendingTaskRecovery();
    await reconcileTaskCleanup();
    startTaskCleanupRecovery();
    if (!workerStopping) markBootReady();
    logger.info("runtime worker bootstrap complete");
  } catch (error) {
    if (!workerStopping) markBootFailed(error);
    logger.error({ err: error }, "runtime worker bootstrap failed");
    throw error;
  }
}

export function bootstrapWorker(): Promise<void> {
  workerBootstrap ??= runWorkerBootstrap();
  return workerBootstrap;
}

export interface WorkerShutdownDependencies {
  markStopping(): void;
  stopRecoveries(): Promise<void>;
  closeWorld(): Promise<void>;
  closeHttp(): Promise<void>;
  closeDatabase(): Promise<void>;
  closeTelemetry(): Promise<void>;
}

export function createWorkerShutdown(dependencies: WorkerShutdownDependencies): () => Promise<void> {
  let shutdown: Promise<void> | undefined;
  return () =>
    (shutdown ??= (async () => {
      dependencies.markStopping();
      let firstError: unknown;
      try {
        await dependencies.stopRecoveries();
      } catch (error) {
        firstError = error;
      }
      try {
        await dependencies.closeWorld();
      } catch (error) {
        firstError ??= error;
      }
      try {
        await dependencies.closeHttp();
      } catch (error) {
        firstError ??= error;
      }
      const trailing = await Promise.allSettled([dependencies.closeDatabase(), dependencies.closeTelemetry()]);
      firstError ??= trailing.find((result) => result.status === "rejected")?.reason;
      if (firstError) throw firstError;
    })());
}

async function stopWorkerRecoveries(): Promise<void> {
  await workerBootstrap?.catch(() => undefined);
  await Promise.all([stopPendingTaskRecovery(), stopTaskCleanupRecovery()]);
}

export function workerShutdown(closeHttp: () => Promise<void>): () => Promise<void> {
  const settings = getWorkerSettings();
  return createWorkerShutdown({
    markStopping: () => {
      workerStopping = true;
      markBootStopping();
    },
    stopRecoveries: stopWorkerRecoveries,
    closeWorld: async () => {
      if (settings.workflowTargetWorld) await (await getWorld()).close?.();
    },
    closeHttp,
    closeDatabase: closeSql,
    closeTelemetry: shutdownOpenTelemetry,
  });
}
