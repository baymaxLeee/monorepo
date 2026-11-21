import type { Experimental_SandboxSession, ModelMessage } from "ai";

import { createRuntimeInputQueue, type RuntimeInputQueue } from "./input-queue.js";
import { createAgentLoop } from "./loop.js";
import type { RuntimeTurnSettings } from "./settings.js";

/** Host resources are registered as soon as acquired, including during preparation. */
export interface TurnScope {
  readonly signal: AbortSignal;
  defer(release: () => void | Promise<void>): void;
}

interface PreparedTurn<C extends Record<string, unknown>, H> {
  messages: ModelMessage[];
  settings: RuntimeTurnSettings<C>;
  host: H;
  sandbox?: Experimental_SandboxSession;
}

export class RuntimeTurn {
  private readonly inbox = createRuntimeInputQueue();
  readonly input: RuntimeInputQueue = this.inbox;
  private readonly controller = new AbortController();
  private readonly resources = new AsyncDisposableStack();
  private started?: Promise<void>;
  private disposal?: Promise<void>;
  readonly signal: AbortSignal;

  private stopRequested = false;

  get cancelled(): boolean {
    return this.stopRequested || this.parent?.aborted === true;
  }

  constructor(private readonly parent?: AbortSignal) {
    this.signal = parent ? AbortSignal.any([parent, this.controller.signal]) : this.controller.signal;
  }

  start<C extends Record<string, unknown>, H>(prepare: (scope: TurnScope) => Promise<PreparedTurn<C, H>>) {
    if (this.disposal) throw new Error("runtime turn already disposed");
    if (this.started) throw new Error("runtime turn already started");
    const start = Promise.resolve().then(async () => {
      try {
        this.signal.throwIfAborted();
        const prepared = await prepare({ signal: this.signal, defer: (release) => this.resources.defer(release) });
        this.signal.throwIfAborted();
        const agent = createAgentLoop(prepared.settings, this.signal);
        const result = await agent.stream({
          messages: prepared.messages,
          abortSignal: this.signal,
          experimental_steering: this.inbox.steering,
          experimental_sandbox: prepared.sandbox,
        });
        return { tools: agent.tools, result, host: prepared.host };
      } catch (error) {
        this.inbox.close(this.signal.aborted ? "aborted" : "error");
        this.controller.abort(error);
        try {
          await this.resources.disposeAsync();
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "turn preparation and cleanup failed", { cause: error });
        }
        throw error;
      }
    });
    this.started = start.then(
      () => undefined,
      () => undefined,
    );
    return start;
  }

  cancel(): void {
    this.stopRequested = true;
    this.controller.abort();
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.inbox.close(this.signal.aborted ? "aborted" : "finished");
    this.disposal = Promise.resolve(this.started).then(() => this.resources.disposeAsync());
    this.controller.abort(new Error("runtime turn already disposed"));
    return this.disposal;
  }
}
