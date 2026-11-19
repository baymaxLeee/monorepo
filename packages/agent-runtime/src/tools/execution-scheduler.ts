type Release = () => void;

interface Waiter {
  parallel: boolean;
  resolve(release: Release): void;
  reject(error: unknown): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

function abortReason(signal: AbortSignal): unknown {
  try {
    signal.throwIfAborted();
  } catch (error) {
    return error;
  }
  return new Error("tool execution aborted before admission");
}

/** A fair, cancellation-aware read/write gate matching Codex's tool runtime. */
export class ToolExecutionScheduler {
  #activeParallel = 0;
  #activeExclusive = false;
  #queue: Waiter[] = [];

  acquire(parallel: boolean, signal?: AbortSignal): Promise<Release> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    return new Promise<Release>((resolve, reject) => {
      const waiter: Waiter = { parallel, resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.#queue.indexOf(waiter);
          if (index < 0) return;
          this.#queue.splice(index, 1);
          reject(abortReason(signal));
          this.#drain();
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.#queue.push(waiter);
      this.#drain();
    });
  }

  async run<T>(parallel: boolean, operation: () => T | PromiseLike<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(parallel, signal);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  stream<T>(parallel: boolean, operation: () => AsyncIterable<T>, signal?: AbortSignal): AsyncIterable<T> {
    const scheduler = this;
    return (async function* () {
      const release = await scheduler.acquire(parallel, signal);
      try {
        yield* operation();
      } finally {
        release();
      }
    })();
  }

  #admit(waiter: Waiter): void {
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
    let released = false;
    if (waiter.parallel) this.#activeParallel += 1;
    else this.#activeExclusive = true;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      if (waiter.parallel) this.#activeParallel -= 1;
      else this.#activeExclusive = false;
      this.#drain();
    });
  }

  #drain(): void {
    if (this.#activeExclusive || this.#queue.length === 0) return;
    const first = this.#queue[0]!;
    if (!first.parallel) {
      if (this.#activeParallel > 0) return;
      this.#queue.shift();
      this.#admit(first);
      return;
    }
    while (this.#queue[0]?.parallel && !this.#activeExclusive) {
      this.#admit(this.#queue.shift()!);
    }
  }
}
