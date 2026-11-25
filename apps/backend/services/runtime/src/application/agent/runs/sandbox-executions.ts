import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { SandboxSession } from "#runtime/transport";

import { sandboxClient } from "../../../infrastructure/clients/sandbox.js";
import type { SandboxAttemptScope, SandboxScope } from "../../../infrastructure/clients/sandbox.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import { getDb } from "../../../infrastructure/persistence/index.js";
import { threads, turnLeases, turnSandboxExecutions } from "../../../infrastructure/persistence/schema.js";
import {
  isMissingSandboxResourceError,
  persistCloudWorkspace,
  type WorkspaceFinalizationSummary,
  workspaceFinalizationIsObsolete,
} from "../../cloud-workspace.js";

export interface SandboxTerminalRecord {
  outcome: "retained" | "destroyed" | "resource_missing" | "superseded";
  finalization?: WorkspaceFinalizationSummary;
}

export interface SandboxExecutionLifecycle {
  restoring(scope: SandboxAttemptScope): Promise<SandboxScope>;
  active(scope: SandboxScope, session: SandboxSession): Promise<void>;
  finalizing(scope: SandboxScope): Promise<void>;
  finalizationFailed(scope: SandboxScope, error: unknown): Promise<void>;
  releasing(scope: SandboxScope, error?: unknown): Promise<void>;
  released(scope: SandboxScope, terminal: SandboxTerminalRecord): Promise<void>;
}

function errorMessage(error: unknown): string | null {
  if (error == null) return null;
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

export const sandboxExecutionLifecycle: SandboxExecutionLifecycle = {
  async restoring(scope) {
    return getDb().transaction(async (tx) => {
      const [thread] = await tx
        .update(threads)
        .set({ sandboxGeneration: sql`${threads.sandboxGeneration} + 1` })
        .where(eq(threads.id, scope.session_id))
        .returning({ workspaceGeneration: threads.sandboxGeneration });
      if (!thread) throw new Error("sandbox session no longer exists");
      const boundScope: SandboxScope = {
        ...scope,
        workspace_generation: thread.workspaceGeneration.toString(),
      };
      const now = new Date();
      await tx.insert(turnSandboxExecutions).values({
        turnId: scope.run_id,
        attemptEpoch: BigInt(scope.attempt_epoch),
        workspaceGeneration: thread.workspaceGeneration,
        threadId: scope.session_id,
        state: "restoring",
        createdAt: now,
        updatedAt: now,
      });
      return boundScope;
    });
  },
  async active(scope, session) {
    const [row] = await getDb()
      .update(turnSandboxExecutions)
      .set({
        state: "active",
        sandboxId: session.id,
        expiresAt: new Date(session.expires_at),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(turnSandboxExecutions.turnId, scope.run_id),
          eq(turnSandboxExecutions.attemptEpoch, BigInt(scope.attempt_epoch)),
          eq(turnSandboxExecutions.state, "restoring"),
        ),
      )
      .returning({ runId: turnSandboxExecutions.turnId });
    if (!row) throw new Error("sandbox execution did not transition from restoring to active");
  },
  async finalizing(scope) {
    const [row] = await getDb()
      .update(turnSandboxExecutions)
      .set({ state: "finalizing", lastError: null, updatedAt: new Date() })
      .where(
        and(
          eq(turnSandboxExecutions.turnId, scope.run_id),
          eq(turnSandboxExecutions.attemptEpoch, BigInt(scope.attempt_epoch)),
          eq(turnSandboxExecutions.state, "active"),
        ),
      )
      .returning({ runId: turnSandboxExecutions.turnId });
    if (!row) throw new Error("sandbox execution did not transition from active to finalizing");
  },
  async finalizationFailed(scope, error) {
    await getDb()
      .update(turnSandboxExecutions)
      .set({ lastError: errorMessage(error), updatedAt: new Date() })
      .where(
        and(
          eq(turnSandboxExecutions.turnId, scope.run_id),
          eq(turnSandboxExecutions.attemptEpoch, BigInt(scope.attempt_epoch)),
          eq(turnSandboxExecutions.state, "finalizing"),
        ),
      );
  },
  async releasing(scope, error) {
    const [row] = await getDb()
      .update(turnSandboxExecutions)
      .set({ state: "releasing", lastError: errorMessage(error), updatedAt: new Date() })
      .where(
        and(
          eq(turnSandboxExecutions.turnId, scope.run_id),
          eq(turnSandboxExecutions.attemptEpoch, BigInt(scope.attempt_epoch)),
        ),
      )
      .returning({ runId: turnSandboxExecutions.turnId });
    if (!row) throw new Error("sandbox execution is not registered for release");
  },
  async released(scope, terminal) {
    const now = new Date();
    const [row] = await getDb()
      .update(turnSandboxExecutions)
      .set({
        state: "released",
        terminalOutcome: terminal.outcome,
        finalizationSummary: terminal.finalization ?? null,
        finalizedAt: terminal.finalization ? now : null,
        releasedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(turnSandboxExecutions.turnId, scope.run_id),
          eq(turnSandboxExecutions.attemptEpoch, BigInt(scope.attempt_epoch)),
          inArray(turnSandboxExecutions.state, ["finalizing", "releasing"]),
        ),
      )
      .returning({ runId: turnSandboxExecutions.turnId });
    if (!row) throw new Error("sandbox execution is not registered for terminal release");
  },
};

export interface ReleasingSandboxExecution {
  scope: SandboxScope;
  sandboxId: string | null;
  state: string;
}

export interface SandboxExecutionReconcilerDependencies {
  list(): Promise<ReleasingSandboxExecution[]>;
  finalize(scope: SandboxScope, sandboxId: string): Promise<WorkspaceFinalizationSummary>;
  retain(scope: SandboxScope, sandboxId: string): Promise<void>;
  releasing(scope: SandboxScope, error?: unknown): Promise<void>;
  destroy(scope: SandboxScope): Promise<void>;
  released(scope: SandboxScope, terminal: SandboxTerminalRecord): Promise<void>;
  failed(scope: SandboxScope, error: unknown): Promise<void>;
}

export const sandboxExecutionReconciliationState = sql`CASE WHEN ${turnSandboxExecutions.state} IN ('active', 'finalizing') AND ${turnSandboxExecutions.sandboxId} IS NOT NULL THEN 'finalizing' ELSE 'releasing' END`;

const reconcilerDefaults: SandboxExecutionReconcilerDependencies = {
  async list() {
    const now = new Date();
    const rows = await getDb().transaction(async (tx) => {
      const candidates = await tx
        .select({ execution: turnSandboxExecutions })
        .from(turnSandboxExecutions)
        .leftJoin(
          turnLeases,
          and(
            eq(turnLeases.turnId, turnSandboxExecutions.turnId),
            eq(turnLeases.attemptEpoch, turnSandboxExecutions.attemptEpoch),
          ),
        )
        .where(
          and(
            inArray(turnSandboxExecutions.state, ["restoring", "active", "finalizing", "releasing"]),
            or(eq(turnSandboxExecutions.state, "releasing"), isNull(turnLeases.turnId), lte(turnLeases.expiresAt, now)),
          ),
        )
        .orderBy(turnSandboxExecutions.updatedAt)
        .limit(100)
        .for("update", { of: turnSandboxExecutions });
      for (const { execution } of candidates) {
        await tx
          .update(turnSandboxExecutions)
          .set({
            state: sandboxExecutionReconciliationState,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(turnSandboxExecutions.turnId, execution.turnId),
              eq(turnSandboxExecutions.attemptEpoch, execution.attemptEpoch),
            ),
          );
      }
      return candidates.map(({ execution }) => execution);
    });
    return rows.map((row) => ({
      scope: {
        session_id: row.threadId,
        run_id: row.turnId,
        attempt_epoch: row.attemptEpoch.toString(),
        workspace_generation: row.workspaceGeneration.toString(),
      },
      sandboxId: row.sandboxId,
      state: (row.state === "active" || row.state === "finalizing") && row.sandboxId ? "finalizing" : "releasing",
    }));
  },
  async finalize(scope, sandboxId) {
    return persistCloudWorkspace(
      {
        sessionId: scope.session_id,
        runId: scope.run_id,
        attemptEpoch: scope.attempt_epoch,
        workspaceGeneration: scope.workspace_generation,
      },
      sandboxId,
    );
  },
  async retain(scope, sandboxId) {
    await sandboxClient().retain(sandboxId, scope);
  },
  releasing: sandboxExecutionLifecycle.releasing,
  async destroy(scope) {
    await sandboxClient().destroy(scope);
  },
  released: sandboxExecutionLifecycle.released,
  async failed(scope, error) {
    await getDb()
      .update(turnSandboxExecutions)
      .set({ lastError: errorMessage(error), updatedAt: new Date() })
      .where(
        and(
          eq(turnSandboxExecutions.turnId, scope.run_id),
          eq(turnSandboxExecutions.attemptEpoch, BigInt(scope.attempt_epoch)),
          inArray(turnSandboxExecutions.state, ["releasing", "finalizing"]),
        ),
      );
  },
};

export async function reconcileSandboxExecutions(
  deps: SandboxExecutionReconcilerDependencies = reconcilerDefaults,
): Promise<void> {
  const executions = await deps.list();
  await Promise.all(
    executions.map(async ({ scope, sandboxId, state }) => {
      try {
        if (state === "finalizing") {
          if (!sandboxId) throw new Error("finalizing sandbox execution has no resource id");
          try {
            const finalization = await deps.finalize(scope, sandboxId);
            await deps.retain(scope, sandboxId);
            await deps.released(scope, { outcome: "retained", finalization });
          } catch (error) {
            if (!workspaceFinalizationIsObsolete(error)) throw error;
            await deps.released(scope, {
              outcome: isMissingSandboxResourceError(error) ? "resource_missing" : "superseded",
            });
          }
          return;
        }
        let terminal: SandboxTerminalRecord = { outcome: "destroyed" };
        try {
          await deps.destroy(scope);
        } catch (error) {
          if (!isMissingSandboxResourceError(error)) throw error;
          terminal = { outcome: "resource_missing" };
        }
        await deps.released(scope, terminal);
      } catch (error) {
        await deps.failed(scope, error);
        logger.error({ err: error, runId: scope.run_id }, "sandbox release retry failed");
      }
    }),
  );
}

export async function markSandboxExecutionsReleasing(runIds: string[]): Promise<void> {
  if (runIds.length === 0) return;
  await getDb()
    .update(turnSandboxExecutions)
    .set({
      state: sandboxExecutionReconciliationState,
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(turnSandboxExecutions.turnId, runIds),
        inArray(turnSandboxExecutions.state, ["restoring", "active", "finalizing", "releasing"]),
      ),
    );
}

const RECONCILE_INTERVAL_MS = 30_000;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;

export function startSandboxExecutionReconciler(): void {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => {
    void reconcileSandboxExecutions().catch((error) =>
      logger.error({ err: error }, "periodic sandbox execution reconcile failed"),
    );
  }, RECONCILE_INTERVAL_MS);
  reconcileTimer.unref();
}
