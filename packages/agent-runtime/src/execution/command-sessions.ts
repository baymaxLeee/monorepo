// Adapted from codex-rs/core/src/unified_exec. An entry owns the launch and all subsequent reads.
import { randomBytes, randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { HeadTailBuffer } from "../output-buffer.js";
import type { OrchestratedCommandResult } from "./orchestrator.js";

export interface RetainedOutputReference {
  /** Host-owned, model-readable path. The command sandbox must not be able to replace it. */
  path: string;
}

export interface ProcessIO {
  readonly signal: AbortSignal;
  readonly tty: boolean;
  output(chunk: string): void;
  retainOutput(reference: RetainedOutputReference): void;
  stdin(writer: (chars: string, requestId: string) => Promise<void>): void;
}

export interface ExecCommandOutput {
  chunk_id: string;
  wall_time_seconds: number;
  exit_code?: number;
  session_id?: number;
  original_token_count: number;
  output: string;
  full_output?: RetainedOutputReference;
}

interface Entry {
  id: number;
  controller: AbortController;
  tty: boolean;
  reviewInput: boolean;
  write?: (chars: string, requestId: string) => Promise<void>;
  output: HeadTailBuffer;
  retainedOutput?: RetainedOutputReference;
  interaction: Promise<void>;
  streamed: boolean;
  result?: OrchestratedCommandResult;
  error?: Error;
  done: Promise<void>;
  interactions: number;
}

const MAX_BYTES = 1024 * 1024;
const MAX_PROCESSES = 64;

export class CommandSessions {
  private closed?: Promise<void>;
  private readonly pending = new Set<Promise<void>>();
  private readonly entries = new Map<number, Entry>();

  private entry(id: number) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown process session ${id}`);
    return entry;
  }

  requiresInputReview(id: number) {
    return this.entry(id).reviewInput;
  }

  private makeRoom() {
    if (this.entries.size < MAX_PROCESSES) return;
    const candidates = [...this.entries.values()].slice(0, -8);
    const exited = candidates.filter((entry) => entry.result || entry.error);
    const victim = (exited.length ? exited : candidates).find((entry) => entry.interactions === 0);
    // Codex treats the cap as soft while candidate terminals are interacting.
    if (!victim) return;
    this.entries.delete(victim.id);
    victim.controller.abort(new Error("Process evicted"));
  }

  async start(
    options: { tty: boolean; reviewInput: boolean; yieldMs: number; tokens: number },
    launch: (io: ProcessIO) => Promise<OrchestratedCommandResult>,
  ) {
    if (this.closed) throw new Error("Process store closed");
    this.makeRoom();
    let id = randomInt(1, 2 ** 31);
    while (this.entries.has(id)) id = randomInt(1, 2 ** 31);
    const entry: Entry = {
      id,
      controller: new AbortController(),
      tty: options.tty,
      reviewInput: options.reviewInput,
      output: new HeadTailBuffer(MAX_BYTES),
      interaction: Promise.resolve(),
      streamed: false,
      interactions: 0,
      done: Promise.resolve(),
    };
    this.entries.set(id, entry);
    entry.done = Promise.resolve()
      .then(() => {
        entry.controller.signal.throwIfAborted();
        return launch({
          signal: entry.controller.signal,
          tty: options.tty,
          output: (text) => {
            if (text) {
              entry.streamed = true;
              entry.output.push(text);
            }
          },
          retainOutput: (reference) => {
            if (!reference.path || reference.path.includes("\0")) throw new Error("Invalid retained output path");
            if (entry.retainedOutput && entry.retainedOutput.path !== reference.path) {
              throw new Error("Process retained output path changed");
            }
            entry.retainedOutput = { path: reference.path };
          },
          stdin: (writer) => {
            entry.write = writer;
          },
        });
      })
      .then((result) => {
        if (!entry.streamed) entry.output.push(result.stdout + result.stderr);
        entry.result = result;
      })
      .catch((error: unknown) => {
        entry.error = error instanceof Error ? error : new Error(String(error));
      });
    this.pending.add(entry.done);
    void entry.done.then(() => this.pending.delete(entry.done));
    return this.read(entry, "", "", Math.max(250, Math.min(30_000, options.yieldMs)), options.tokens);
  }

  async write(id: number, chars: string, requestId: string, yieldMs: number, tokens: number) {
    const entry = this.entry(id);
    this.entries.delete(id);
    this.entries.set(id, entry);
    return this.read(
      entry,
      chars,
      requestId,
      chars ? Math.max(250, Math.min(yieldMs, 30_000)) : Math.max(5000, Math.min(yieldMs, 300_000)),
      tokens,
    );
  }

  private async read(
    entry: Entry,
    chars: string,
    requestId: string,
    yieldMs: number,
    tokens: number,
  ): Promise<{ output: ExecCommandOutput; termination?: OrchestratedCommandResult["termination"] }> {
    const previous = entry.interaction;
    let release!: () => void;
    entry.interaction = new Promise<void>((resolve) => {
      release = resolve;
    });
    entry.interactions++;
    await previous;
    const timer = new AbortController();
    const start = performance.now();
    try {
      if (this.entries.get(entry.id) !== entry) throw new Error(`Unknown process session ${entry.id}`);
      if (chars) {
        if (!entry.tty || !entry.write || entry.result || entry.error) throw new Error("Process stdin is closed");
        await entry.write(chars, requestId);
      }
      await Promise.race([entry.done, delay(yieldMs, undefined, { signal: timer.signal })]);
      entry.controller.signal.throwIfAborted();
      if (entry.error) throw entry.error;
      const { output, originalTokens, truncated } = entry.output.drain(tokens);
      const terminal = entry.result?.termination;
      return {
        output: {
          chunk_id: randomBytes(3).toString("hex"),
          wall_time_seconds: (performance.now() - start) / 1000,
          ...(terminal?.type === "exit" ? { exit_code: terminal.exitCode } : {}),
          ...(!terminal ? { session_id: entry.id } : {}),
          original_token_count: originalTokens,
          output,
          ...(truncated && entry.retainedOutput ? { full_output: entry.retainedOutput } : {}),
        },
        termination: terminal,
      };
    } finally {
      entry.interactions--;
      release();
      timer.abort();
      if ((entry.result || entry.error) && this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
    }
  }

  close() {
    if (this.closed) return this.closed;
    this.closed = Promise.all(this.pending).then(() => undefined);
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) entry.controller.abort(new Error("Process store closed"));
    return this.closed;
  }
}
