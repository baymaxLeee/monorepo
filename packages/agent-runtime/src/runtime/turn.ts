import type { Experimental_SandboxSession, ModelMessage } from "ai";

import { createRuntimeInputQueue, type RuntimeInputQueue } from "./input-queue.js";
import { createAgentLoop } from "./loop.js";
import type { RuntimeTurnSettings } from "./types.js";

export interface RuntimeTurnPreparation<C extends Record<string, unknown>, H> {
  settings: RuntimeTurnSettings<C>;
  host: H;
  sandbox?: Experimental_SandboxSession;
  dispose?: () => Promise<void>;
}

export interface StartRuntimeTurnOptions<C extends Record<string, unknown>, H> {
  messages: ModelMessage[];
  signal?: AbortSignal;
  prepare(input: RuntimeInputQueue): Promise<RuntimeTurnPreparation<C, H>>;
}

/**
 * One Codex-shaped turn boundary around the SDK-owned loop. The runtime owns
 * input admission and resource finalization; hosts only bind capabilities.
 */
export class RuntimeTurn {
  readonly input = createRuntimeInputQueue();
  private prepared: { dispose?: () => Promise<void> } | undefined;
  private started: Promise<unknown> | undefined;
  private disposePromise: Promise<void> | undefined;
  private disposed = false;

  start<C extends Record<string, unknown>, H>(options: StartRuntimeTurnOptions<C, H>) {
    if (this.started) throw new Error("runtime turn already started");
    if (this.disposed) throw new Error("runtime turn already disposed");
    const started = this.startOnce(options);
    this.started = started;
    return started;
  }

  private async startOnce<C extends Record<string, unknown>, H>(options: StartRuntimeTurnOptions<C, H>) {
    try {
      const prepared = await options.prepare(this.input);
      this.prepared = prepared;
      const agent = createAgentLoop({ ...prepared.settings, inputChannel: this.input });
      const result = await agent.stream({
        messages: options.messages,
        abortSignal: options.signal,
        experimental_steering: this.input.steering,
        ...(prepared.sandbox ? { experimental_sandbox: prepared.sandbox } : {}),
      });
      return { agent, result, host: prepared.host };
    } catch (error) {
      await this.disposePrepared();
      throw error;
    }
  }

  private disposePrepared(): Promise<void> {
    this.disposePromise ??= this.prepared?.dispose?.() ?? Promise.resolve();
    return this.disposePromise;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.started?.catch(() => undefined);
    await this.disposePrepared();
  }
}

export function createRuntimeTurn(): RuntimeTurn {
  return new RuntimeTurn();
}

export type { RuntimeInputQueue } from "./input-queue.js";
