import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { SandboxSession } from "#runtime/transport";

import { sandboxClient } from "../../../infrastructure/clients/sandbox.js";
import type { SandboxScope } from "../../../infrastructure/clients/sandbox.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import { getDb } from "../../../infrastructure/persistence/index.js";
import { turnLeases, turnSandboxExecutions } from "../../../infrastructure/persistence/schema.js";
import {
  isMissingSandboxResourceError,
  persistCloudWorkspace,
  workspaceFinalizationIsObsolete,
} from "../../cloud-workspace.js";

export interface SandboxExecutionLifecycle {
  restoring(scope: SandboxScope): Promise<void>;
  active(scope: SandboxScope, session: SandboxSession): Promise<void>;
  finalizing(scope: SandboxScope): Promise<void>;
  finalizationFailed(scope: SandboxScope, error: unknown): Promise<void>;
  releasing(scope: SandboxScope, error?: unknown): Promise<void>;
  released(scope: SandboxScope): Promise<void>;
}

function errorMessage(error: unknown): string | null {
  if (error == null) return null;
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

export const sandboxExecutionLifecycle: SandboxExecutionLifecycle = {
  async restoring(scope) {
    const now = new Date();
    await getDb()
      .insert(turnSandboxExecutions)
      .values({
        turnId: scope.run_id,
        attemptEpoch: BigInt(scope.attempt_epoch),
        threadId: scope.session_id,
        userId: scope.user_id,
        tenantId: scope.tenant_id,
        workspaceId: scope.workspace_id,
        state: "restoring",
        createdAt: now,
        updatedAt: now,
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
  async released(scope) {
    await getDb()
      .delete(turnSandboxExecutions)
      .where(
        and(
          eq(turnSandboxExecutions.turnId, scope.run_id),
          eq(turnSandboxExecutions.attemptEpoch, BigInt(scope.attempt_epoch)),
          inArray(turnSandboxExecutions.state, ["finalizing", "releasing"]),
        ),
      );
  },
};

export interface ReleasingSandboxExecution {
  scope: SandboxScope;
  sandboxId: string | null;
  state: string;
}

export interface SandboxExecutionReconcilerDependencies {
  list(): Promise<ReleasingSandboxExecution[]>;
  finalize(scope: SandboxScope, sandboxId: string): Promise<void>;
  releasing(scope: SandboxScope, error?: unknown): Promise<void>;
  destroy(scope: SandboxScope): Promise<void>;
  released(scope: SandboxScope): Promise<void>;
  failed(scope: SandboxScope, error: unknown): Promise<void>;
}

export const sandboxExecutionReconciliationState = sql`CASE WHEN ${turnSandboxExecutions.state} IN ('active', 'finalizing') AND ${turnSandboxExecutions.expiresAt} > CURRENT_TIMESTAMP THEN 'finalizing' ELSE 'releasing' END`;

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
          or(eq(turnSandboxExecutions.state, "releasing"), isNull(turnLeases.turnId), lte(turnLeases.expiresAt, now)),
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
        tenant_id: row.tenantId,
        workspace_id: row.workspaceId,
        user_id: row.userId,
        session_id: row.threadId,
        run_id: row.turnId,
        attempt_epoch: row.attemptEpoch.toString(),
      },
      sandboxId: row.sandboxId,
      state:
        (row.state === "active" || row.state === "finalizing") && row.expiresAt && row.expiresAt > now
          ? "finalizing"
          : "releasing",
    }));
  },
  async finalize(scope, sandboxId) {
    await persistCloudWorkspace(
      {
        tenantId: scope.tenant_id,
        workspaceId: scope.workspace_id,
        userId: scope.user_id,
        sessionId: scope.session_id,
        runId: scope.run_id,
        attemptEpoch: scope.attempt_epoch,
      },
      sandboxId,
    );
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
          let releaseReason: unknown;
          try {
            await deps.finalize(scope, sandboxId);
          } catch (error) {
            if (!workspaceFinalizationIsObsolete(error)) throw error;
            releaseReason = error;
          }
          await deps.releasing(scope, releaseReason);
        }
        try {
          await deps.destroy(scope);
        } catch (error) {
          if (!isMissingSandboxResourceError(error)) throw error;
        }
        await deps.released(scope);
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
      state: sql`CASE WHEN ${turnSandboxExecutions.state} IN ('active', 'finalizing') AND ${turnSandboxExecutions.expiresAt} > NOW() THEN 'finalizing' ELSE 'releasing' END`,
      updatedAt: new Date(),
    })
    .where(inArray(turnSandboxExecutions.turnId, runIds));
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
