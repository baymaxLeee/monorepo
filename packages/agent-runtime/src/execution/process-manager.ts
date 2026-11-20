import { randomUUID } from "node:crypto";

export type ProcessState = "starting" | "running" | "exited";

export interface ProcessIdentity {
  processId: number;
  entryId: string;
}

interface ProcessEntry extends ProcessIdentity {
  state: ProcessState;
  process: { terminate(): void } | null;
}

export class ProcessManager {
  private readonly entries = new Map<number, ProcessEntry>();
  private readonly reusable: number[] = [];
  private nextProcessId = 1;

  reserve(): ProcessIdentity {
    const processId = this.reusable.shift() ?? this.nextProcessId++;
    const identity = { processId, entryId: randomUUID() };
    this.entries.set(processId, { ...identity, state: "starting", process: null });
    return identity;
  }

  private entry(identity: ProcessIdentity): ProcessEntry {
    const entry = this.entries.get(identity.processId);
    if (!entry || entry.entryId !== identity.entryId) {
      throw new Error(`unknown process ${identity.processId}`);
    }
    return entry;
  }

  get(identity: ProcessIdentity): ProcessEntry["process"] {
    return this.entry(identity).process;
  }

  contains(identity: ProcessIdentity): boolean {
    const entry = this.entries.get(identity.processId);
    return Boolean(entry && entry.entryId === identity.entryId);
  }

  state(identity: ProcessIdentity): ProcessState {
    return this.entry(identity).state;
  }

  markRunning(identity: ProcessIdentity, process: { terminate(): void }): void {
    const entry = this.entry(identity);
    if (entry.state !== "starting") throw new Error(`process ${identity.processId} is not starting`);
    entry.process = process;
    entry.state = "running";
  }

  markExited(identity: ProcessIdentity): void {
    const entry = this.entry(identity);
    if (entry.state !== "running" && entry.state !== "starting") {
      throw new Error(`process ${identity.processId} cannot exit from ${entry.state}`);
    }
    entry.state = "exited";
  }

  async run<R>(operation: (identity: ProcessIdentity, signal: AbortSignal) => Promise<R>): Promise<R> {
    const identity = this.reserve();
    const controller = new AbortController();
    this.markRunning(identity, {
      terminate: () => controller.abort(new Error(`process ${identity.processId} closed`)),
    });
    try {
      const result = await operation(identity, controller.signal);
      controller.signal.throwIfAborted();
      this.markExited(identity);
      return result;
    } finally {
      if (this.contains(identity)) this.close(identity);
    }
  }

  close(identity: ProcessIdentity): void {
    const entry = this.entry(identity);
    this.entries.delete(identity.processId);
    this.reusable.push(identity.processId);
    this.reusable.sort((left, right) => left - right);
    if (entry.state === "running") entry.process?.terminate();
  }

  closeAll(): void {
    // Match Codex ProcessStore::drain: revoke all handles before native teardown can re-enter.
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) this.reusable.push(entry.processId);
    this.reusable.sort((left, right) => left - right);
    using cleanup = new DisposableStack();
    for (const entry of entries) {
      if (entry.state === "running" && entry.process) {
        const process = entry.process;
        cleanup.defer(() => process.terminate());
      }
    }
  }
}
