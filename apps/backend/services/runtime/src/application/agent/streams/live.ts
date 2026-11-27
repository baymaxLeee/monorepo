import { getDefaultHighWaterMark } from "node:stream";

import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";

interface ActiveDelta {
  start: number;
  delta?: number;
}

interface ActiveToolInput {
  indices: number[];
  delta?: number;
}

function isDataChunk(chunk: UIMessageChunk): chunk is Extract<UIMessageChunk, { type: `data-${string}` }> {
  return chunk.type.startsWith("data-");
}

function sameMessageStart(left: UIMessageChunk, right: Extract<UIMessageChunk, { type: "start" }>): boolean {
  return left.type === "start" && left.messageId === right.messageId;
}

function isMergeableObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

// Mirrors the AI SDK's message metadata semantics: nested objects merge,
// arrays and primitives replace, and undefined updates are ignored.
function mergeSemanticObjects(base: unknown, overrides: unknown): unknown {
  if (!isMergeableObject(base) || !isMergeableObject(overrides)) return structuredClone(overrides);
  const merged: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype" || value === undefined) continue;
    merged[key] =
      isMergeableObject(merged[key]) && isMergeableObject(value)
        ? mergeSemanticObjects(merged[key], value)
        : structuredClone(value);
  }
  return merged;
}

/**
 * Materialized replay for one active UIMessage. It stores semantic state, not
 * encoded SSE bytes: token deltas are coalesced and mutable tool/metadata
 * updates replace their predecessors.
 */
export class ActiveStreamProjection {
  readonly #chunks: UIMessageChunk[] = [];
  readonly #activeDeltas = new Map<string, ActiveDelta>();
  readonly #activeToolInputs = new Map<string, ActiveToolInput>();
  readonly #latest = new Map<string, number>();
  #lastStepStart = -1;

  snapshot(): UIMessageChunk[] {
    return structuredClone(this.#chunks);
  }

  apply(chunk: UIMessageChunk): void {
    if (isDataChunk(chunk) && chunk.transient) return;

    switch (chunk.type) {
      case "start": {
        const key = `start:${chunk.messageId ?? ""}`;
        const index = this.#latest.get(key);
        if (index !== undefined && sameMessageStart(this.#chunks[index], chunk))
          this.#chunks[index] = structuredClone(chunk);
        else this.#push(chunk);
        return;
      }
      case "text-start":
      case "reasoning-start":
      case "text-end":
      case "reasoning-end":
      case "tool-input-start":
        this.#push(chunk);
        return;
      case "text-delta":
        this.#appendDelta(chunk, "text");
        return;
      case "reasoning-delta":
        this.#appendDelta(chunk, "reasoning");
        return;
      case "tool-input-delta":
        this.#appendToolInputDelta(chunk);
        return;
      case "tool-input-available":
      case "tool-input-error":
        this.#replaceToolInput(chunk);
        return;
      case "tool-output-available":
      case "tool-output-error":
      case "tool-output-denied":
        this.#replaceLatest(`tool-output:${chunk.toolCallId}`, chunk);
        return;
      case "message-metadata":
        this.#mergeMessageMetadata(chunk);
        return;
      case "reset-step": {
        if (this.#lastStepStart >= 0) {
          this.#chunks.splice(this.#lastStepStart + 1);
          this.#rebuildIndexes();
        }
        return;
      }
      case "finish":
      case "abort":
      case "error":
        this.#replaceLatest("terminal", chunk);
        return;
      default:
        if (isDataChunk(chunk) && chunk.id) {
          this.#replaceLatest(`data:${chunk.type}:${chunk.id}`, chunk);
          return;
        }
        this.#push(chunk);
    }
  }

  #appendDelta(
    chunk: Extract<UIMessageChunk, { type: "text-delta" | "reasoning-delta" }>,
    kind: "text" | "reasoning",
  ): void {
    const active = this.#activeDeltas.get(`${kind}:${chunk.id}`);
    if (active?.delta !== undefined) {
      const current = this.#chunks[active.delta] as typeof chunk;
      this.#chunks[active.delta] = {
        ...current,
        delta: current.delta + chunk.delta,
        ...(chunk.providerMetadata != null ? { providerMetadata: structuredClone(chunk.providerMetadata) } : {}),
      };
      return;
    }
    this.#push(chunk);
  }

  #appendToolInputDelta(chunk: Extract<UIMessageChunk, { type: "tool-input-delta" }>): void {
    const active = this.#activeToolInputs.get(chunk.toolCallId);
    if (active?.delta !== undefined) {
      const current = this.#chunks[active.delta] as Extract<UIMessageChunk, { type: "tool-input-delta" }>;
      this.#chunks[active.delta] = { ...current, inputTextDelta: current.inputTextDelta + chunk.inputTextDelta };
      return;
    }
    this.#push(chunk);
  }

  #replaceToolInput(chunk: Extract<UIMessageChunk, { type: "tool-input-available" | "tool-input-error" }>): void {
    const indices = this.#activeToolInputs.get(chunk.toolCallId)?.indices ?? [];
    const insertAt = indices[0] ?? this.#chunks.length;
    for (const index of [...indices].reverse()) this.#chunks.splice(index, 1);
    this.#chunks.splice(insertAt, 0, structuredClone(chunk));
    this.#rebuildIndexes();
  }

  #mergeMessageMetadata(chunk: Extract<UIMessageChunk, { type: "message-metadata" }>): void {
    const index = this.#latest.get("metadata");
    if (index === undefined) {
      this.#push(chunk);
      return;
    }
    const current = this.#chunks[index] as Extract<UIMessageChunk, { type: "message-metadata" }>;
    this.#chunks[index] = {
      ...structuredClone(chunk),
      messageMetadata: mergeSemanticObjects(current.messageMetadata, chunk.messageMetadata),
    } as typeof chunk;
  }

  #replaceLatest(key: string, chunk: UIMessageChunk): void {
    const index = this.#latest.get(key);
    if (index !== undefined) this.#chunks[index] = structuredClone(chunk);
    else this.#push(chunk);
  }

  #push(chunk: UIMessageChunk): void {
    const index = this.#chunks.push(structuredClone(chunk)) - 1;
    this.#indexChunk(this.#chunks[index], index);
  }

  #indexChunk(chunk: UIMessageChunk, index: number): void {
    switch (chunk.type) {
      case "start":
        this.#latest.set(`start:${chunk.messageId ?? ""}`, index);
        return;
      case "start-step":
        this.#lastStepStart = index;
        return;
      case "text-start":
      case "reasoning-start":
        this.#activeDeltas.set(`${chunk.type === "text-start" ? "text" : "reasoning"}:${chunk.id}`, { start: index });
        return;
      case "text-delta":
      case "reasoning-delta": {
        const key = `${chunk.type === "text-delta" ? "text" : "reasoning"}:${chunk.id}`;
        const active = this.#activeDeltas.get(key);
        if (active) active.delta = index;
        return;
      }
      case "text-end":
      case "reasoning-end":
        this.#activeDeltas.delete(`${chunk.type === "text-end" ? "text" : "reasoning"}:${chunk.id}`);
        return;
      case "tool-input-start":
        this.#activeToolInputs.set(chunk.toolCallId, { indices: [index] });
        return;
      case "tool-input-delta": {
        const active = this.#activeToolInputs.get(chunk.toolCallId);
        if (active) {
          active.indices.push(index);
          active.delta = index;
        }
        return;
      }
      case "tool-input-available":
      case "tool-input-error":
        this.#activeToolInputs.delete(chunk.toolCallId);
        return;
      case "tool-output-available":
      case "tool-output-error":
      case "tool-output-denied":
        this.#latest.set(`tool-output:${chunk.toolCallId}`, index);
        return;
      case "message-metadata":
        this.#latest.set("metadata", index);
        return;
      case "finish":
      case "abort":
      case "error":
        this.#latest.set("terminal", index);
        return;
      default:
        if (isDataChunk(chunk) && chunk.id) this.#latest.set(`data:${chunk.type}:${chunk.id}`, index);
    }
  }

  #rebuildIndexes(): void {
    this.#activeDeltas.clear();
    this.#activeToolInputs.clear();
    this.#latest.clear();
    this.#lastStepStart = -1;
    this.#chunks.forEach((chunk, index) => this.#indexChunk(chunk, index));
  }
}

export class ActiveRunStream {
  readonly #projection = new ActiveStreamProjection();
  readonly #subscribers = new Set<ReadableStreamDefaultController<UIMessageChunk>>();
  #closed = false;

  constructor(
    readonly sessionId: string,
    readonly runId: string,
    readonly attemptEpoch: bigint,
  ) {}

  publish(chunk: UIMessageChunk): void {
    if (this.#closed) return;
    this.#projection.apply(chunk);
    for (const subscriber of this.#subscribers) {
      if ((subscriber.desiredSize ?? 0) > 0) subscriber.enqueue(chunk);
      else {
        this.#subscribers.delete(subscriber);
        subscriber.error(new Error("Stream reader fell behind; reconnect to resume."));
      }
    }
  }

  subscribe(): ReadableStream<UIMessageChunk> {
    // Register the live reader in the same synchronous turn as the snapshot.
    // A tail can start mid-step, so only the complete Run projection may fold events.
    const replay = this.#projection.snapshot();
    let index = 0;
    let subscription: ReadableStreamDefaultController<UIMessageChunk>;
    const tail = new ReadableStream<UIMessageChunk>(
      {
        start: (controller) => {
          subscription = controller;
          if (this.#closed) controller.close();
          else this.#subscribers.add(controller);
        },
        cancel: () => {
          this.#subscribers.delete(subscription);
        },
      },
      { highWaterMark: getDefaultHighWaterMark(true) },
    ).getReader();
    return new ReadableStream<UIMessageChunk>({
      async pull(controller) {
        if (index < replay.length) {
          controller.enqueue(replay[index++]);
          if (index === replay.length) replay.length = 0;
          return;
        }
        const next = await tail.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      cancel: (reason) => tail.cancel(reason),
    });
  }

  async consume(stream: ReadableStream<UIMessageChunk>): Promise<void> {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.publish(value);
      }
      this.close();
    } catch (error) {
      this.publish({ type: "error", errorText: "模型调用失败，请稍后重试。" });
      this.close();
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const subscriber of this.#subscribers) subscriber.close();
    this.#subscribers.clear();
  }
}

const activeBySession = new Map<string, ActiveRunStream>();

export function registerActiveRunStream(sessionId: string, runId: string, attemptEpoch: bigint): ActiveRunStream {
  const previous = activeBySession.get(sessionId);
  if (previous && (previous.runId !== runId || previous.attemptEpoch !== attemptEpoch)) previous.close();
  if (previous?.runId === runId && previous.attemptEpoch === attemptEpoch) return previous;
  const stream = new ActiveRunStream(sessionId, runId, attemptEpoch);
  activeBySession.set(sessionId, stream);
  return stream;
}

export function releaseActiveRunStream(stream: ActiveRunStream): void {
  stream.close();
  if (activeBySession.get(stream.sessionId) === stream) activeBySession.delete(stream.sessionId);
}

export function resumeActiveRunStream(sessionId: string, runId: string): Response | null {
  const stream = activeBySession.get(sessionId);
  if (!stream || stream.runId !== runId) return null;
  return createUIMessageStreamResponse({
    stream: stream.subscribe(),
    headers: { "x-agent-run-id": runId },
  });
}

export function activeRunStreamResponse(stream: ActiveRunStream): Response {
  return createUIMessageStreamResponse({
    stream: stream.subscribe(),
    headers: { "x-agent-run-id": stream.runId },
  });
}

export function duplicateActiveRunResponse(sessionId: string, runId: string, hasPageTools: boolean): Response {
  // A second POST may be consumed by another renderer. GET subscribers can
  // display the same buffered calls without becoming their executor.
  if (hasPageTools) return detachedActiveRunResponse(runId, 409, "Reconnect to observe the active page-tool Turn.");
  return resumeActiveRunStream(sessionId, runId) ?? detachedActiveRunResponse(runId, 409);
}

export function detachedActiveRunResponse(
  runId: string,
  status: 204 | 409,
  message = "The logical Turn is active but its live stream is not on this process.",
): Response {
  const headers = { "x-agent-run-id": runId, "x-agent-run-state": "active-detached" };
  if (status === 204) return new Response(null, { status, headers });
  return Response.json({ code: "active_run_detached", message }, { status, headers });
}
