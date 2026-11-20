import { randomUUID } from "node:crypto";

export type ProcessState = "starting" | "running" | "exited" | "closed";

export interface ProcessIdentity {
  processId: number;
  entryId: string;
}

interface ProcessEntry<T extends { terminate(): void }> extends ProcessIdentity {
  state: ProcessState;
  process: T | null;
}

export class ProcessManager<T extends { terminate(): void }> {
  private readonly entries = new Map<number, ProcessEntry<T>>();
  private readonly reusable: number[] = [];
  private nextProcessId = 1;

  reserve(): ProcessIdentity {
    const processId = this.reusable.shift() ?? this.nextProcessId++;
    const identity = { processId, entryId: randomUUID() };
    this.entries.set(processId, { ...identity, state: "starting", process: null });
    return identity;
  }

  private entry(identity: ProcessIdentity): ProcessEntry<T> {
    const entry = this.entries.get(identity.processId);
    if (!entry || entry.entryId !== identity.entryId || entry.state === "closed") {
      throw new Error(`unknown process ${identity.processId}`);
    }
    return entry;
  }

  get(identity: ProcessIdentity): T | null {
    return this.entry(identity).process;
  }

  contains(identity: ProcessIdentity): boolean {
    const entry = this.entries.get(identity.processId);
    return Boolean(entry && entry.entryId === identity.entryId && entry.state !== "closed");
  }

  state(identity: ProcessIdentity): ProcessState {
    return this.entry(identity).state;
  }

  markRunning(identity: ProcessIdentity, process: T): void {
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
    } as T);
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
    if (entry.state === "running") entry.process?.terminate();
    entry.state = "closed";
    this.entries.delete(identity.processId);
    this.reusable.push(identity.processId);
    this.reusable.sort((left, right) => left - right);
  }

  closeAll(): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.state === "running") entry.process?.terminate();
      entry.state = "closed";
      this.entries.delete(entry.processId);
      this.reusable.push(entry.processId);
    }
    this.reusable.sort((left, right) => left - right);
  }
}
