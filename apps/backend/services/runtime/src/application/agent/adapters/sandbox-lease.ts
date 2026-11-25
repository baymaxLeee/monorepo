import type { SandboxSession } from "#runtime/transport";

import type {
  RuntimeSandboxAdapter,
  SandboxAttemptScope,
  SandboxScope,
} from "../../../infrastructure/clients/sandbox.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import {
  isMissingSandboxResourceError,
  type WorkspaceFinalizationSummary,
  workspaceFinalizationIsObsolete,
} from "../../cloud-workspace.js";
import type { SandboxExecutionLifecycle, SandboxTerminalRecord } from "../runs/sandbox-executions.js";

interface SandboxLeaseOptions {
  scope: SandboxAttemptScope;
  client: () => Pick<RuntimeSandboxAdapter, "create" | "destroy" | "retain">;
  journal: SandboxExecutionLifecycle;
  restore(id: string, scope: SandboxScope): Promise<unknown>;
  persist(id: string, scope: SandboxScope): Promise<WorkspaceFinalizationSummary>;
  stopProcesses(): void;
  owner?: AbortSignal;
}

/** One attempt owns one lazy guest, from durable reservation through workspace publication. */
export class SandboxLease {
  private readonly lifetime = new AbortController();
  readonly signal: AbortSignal = this.lifetime.signal;
  private opening?: Promise<SandboxSession>;
  private closing?: Promise<void>;
  private reserved = false;
  private active?: SandboxSession;
  private boundScope?: SandboxScope;

  constructor(private readonly options: SandboxLeaseOptions) {
    if (options.owner?.aborted) this.onStop();
    else options.owner?.addEventListener("abort", this.onStop, { once: true });
  }

  private readonly onStop = () => {
    void this.close().catch((err) => logger.error({ err }, "sandbox stop cleanup failed"));
  };

  get started() {
    return this.opening !== undefined;
  }
  get attached() {
    return this.active !== undefined && !this.closing;
  }
  get scope(): SandboxScope {
    if (!this.boundScope) throw new Error("sandbox workspace is not attached");
    return this.boundScope;
  }

  async open(signal?: AbortSignal): Promise<SandboxSession> {
    signal?.throwIfAborted();
    if (this.closing) throw new Error("This run's sandbox is closed; the workspace is no longer attached.");
    this.opening ??= this.acquire();
    let session: SandboxSession;
    try {
      session = await this.opening;
    } catch (error) {
      await this.close();
      signal?.throwIfAborted();
      throw error;
    }
    this.signal.throwIfAborted();
    signal?.throwIfAborted();
    return session;
  }

  private async acquire() {
    const { scope: attemptScope, client, journal, restore } = this.options;
    const scope = await journal.restoring(attemptScope);
    this.boundScope = scope;
    this.reserved = true;
    // Observe create before destroy: a timed-out or cancelled request may still allocate a guest.
    const session = await client().create(scope);
    this.signal.throwIfAborted();
    await restore(session.id, scope);
    await journal.active(scope, session);
    this.active = session;
    return session;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = Promise.resolve().then(async () => {
      try {
        this.options.stopProcesses();
      } finally {
        await this.finalize();
      }
    });
    this.options.owner?.removeEventListener("abort", this.onStop);
    this.lifetime.abort(this.options.owner?.reason);
    return this.closing;
  }

  private async finalize() {
    const { client, journal, persist } = this.options;
    await this.opening?.catch(() => undefined);
    if (!this.reserved) return;
    const scope = this.scope;
    if (this.active) {
      try {
        await journal.finalizing(scope);
        const finalization = await persist(this.active.id, scope);
        await client().retain(this.active.id, scope);
        await journal.released(scope, { outcome: "retained", finalization });
        return;
      } catch (error) {
        if (!workspaceFinalizationIsObsolete(error)) {
          await journal.finalizationFailed(scope, error);
          throw error;
        }
        await journal.released(scope, {
          outcome: isMissingSandboxResourceError(error) ? "resource_missing" : "superseded",
        });
        throw error;
      }
    }
    await this.release(undefined, { outcome: "destroyed" });
  }

  private async release(reason: unknown, terminal: SandboxTerminalRecord) {
    const { client, journal } = this.options;
    const scope = this.scope;
    await journal.releasing(scope, reason);
    try {
      await client().destroy(scope);
    } catch (error) {
      if (!isMissingSandboxResourceError(error)) {
        await journal.releasing(scope, error);
        throw error;
      }
      if (terminal.outcome !== "superseded") terminal = { ...terminal, outcome: "resource_missing" };
    }
    await journal.released(scope, terminal);
  }
}
