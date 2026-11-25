import assert from "node:assert/strict";
import test from "node:test";

import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";

import { ActiveRunStream, ActiveStreamProjection, detachedActiveRunResponse } from "./live.js";

async function finalMessage(chunks: UIMessageChunk[]): Promise<UIMessage | undefined> {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
  let final: UIMessage | undefined;
  for await (const message of readUIMessageStream<UIMessage>({ stream })) final = message;
  return final;
}

test("active projection coalesces deltas and keeps semantic tool state", () => {
  const projection = new ActiveStreamProjection();
  const chunks: UIMessageChunk[] = [
    { type: "start", messageId: "assistant", messageMetadata: { status: "streaming" } },
    { type: "start-step" },
    { type: "text-start", id: "text" },
    { type: "text-delta", id: "text", delta: "hello " },
    { type: "text-delta", id: "text", delta: "world" },
    { type: "text-end", id: "text" },
    { type: "tool-input-start", toolCallId: "tool", toolName: "bash" },
    { type: "tool-input-delta", toolCallId: "tool", inputTextDelta: '{"cmd":' },
    { type: "tool-input-delta", toolCallId: "tool", inputTextDelta: '"pwd"}' },
    { type: "tool-input-available", toolCallId: "tool", toolName: "bash", input: { cmd: "pwd" } },
    { type: "tool-output-available", toolCallId: "tool", output: { stdout: "first" }, preliminary: true },
    { type: "tool-output-available", toolCallId: "tool", output: { stdout: "final" } },
    { type: "data-model-retry", data: { state: "retrying" }, transient: true },
  ];
  chunks.forEach((chunk) => projection.apply(chunk));

  assert.deepEqual(projection.snapshot(), [
    { type: "start", messageId: "assistant", messageMetadata: { status: "streaming" } },
    { type: "start-step" },
    { type: "text-start", id: "text" },
    { type: "text-delta", id: "text", delta: "hello world" },
    { type: "text-end", id: "text" },
    { type: "tool-input-available", toolCallId: "tool", toolName: "bash", input: { cmd: "pwd" } },
    { type: "tool-output-available", toolCallId: "tool", output: { stdout: "final" } },
  ]);
});

test("resume subscribes after its snapshot without losing the next live chunk", async () => {
  const active = new ActiveRunStream("session", "run", 1n);
  active.publish({ type: "start", messageId: "assistant" });
  active.publish({ type: "text-start", id: "text" });
  active.publish({ type: "text-delta", id: "text", delta: "before" });

  const reader = active.subscribe().getReader();
  assert.deepEqual((await reader.read()).value, { type: "start", messageId: "assistant" });
  assert.deepEqual((await reader.read()).value, { type: "text-start", id: "text" });
  assert.deepEqual((await reader.read()).value, { type: "text-delta", id: "text", delta: "before" });

  active.publish({ type: "text-delta", id: "text", delta: " after" });
  assert.deepEqual((await reader.read()).value, { type: "text-delta", id: "text", delta: " after" });
  active.close();
  assert.equal((await reader.read()).done, true);
});

test("projection replay preserves SDK metadata merge and latest provider metadata at every cut", async () => {
  const chunks: UIMessageChunk[] = [
    { type: "start", messageId: "assistant", messageMetadata: { status: "streaming", nested: { first: 1 } } },
    { type: "message-metadata", messageMetadata: { nested: { second: 2 } } },
    { type: "text-start", id: "text" },
    { type: "text-delta", id: "text", delta: "one", providerMetadata: { openai: { phase: "first" } } },
    { type: "message-metadata", messageMetadata: { usage: { input: 3 } } },
    { type: "text-delta", id: "text", delta: " two", providerMetadata: { openai: { phase: "second" } } },
    { type: "text-delta", id: "text", delta: " three" },
    { type: "text-end", id: "text" },
    { type: "finish", finishReason: "stop", messageMetadata: { status: "completed" } },
  ];
  const direct = await finalMessage(chunks);

  for (let cut = 1; cut < chunks.length; cut += 1) {
    const projection = new ActiveStreamProjection();
    chunks.slice(0, cut).forEach((chunk) => projection.apply(chunk));
    const replayed = await finalMessage([...projection.snapshot(), ...chunks.slice(cut)]);
    assert.deepEqual(replayed, direct, `semantic replay diverged at chunk ${cut}`);
  }
  assert.deepEqual(direct?.metadata, {
    status: "completed",
    nested: { first: 1, second: 2 },
    usage: { input: 3 },
  });
  assert.deepEqual(direct?.parts[0], {
    type: "text",
    text: "one two three",
    state: "done",
    providerMetadata: { openai: { phase: "second" } },
  });
});

test("a stalled subscriber is disconnected without delaying the Run or another subscriber", async () => {
  const active = new ActiveRunStream("session", "run", 1n);
  active.publish({ type: "start", messageId: "assistant" });
  const stalled = active.subscribe().getReader();
  const flowing = active.subscribe().getReader();
  assert.deepEqual((await flowing.read()).value, { type: "start", messageId: "assistant" });

  active.publish({ type: "text-start", id: "text" });
  assert.deepEqual((await flowing.read()).value, { type: "text-start", id: "text" });
  active.publish({ type: "text-delta", id: "text", delta: "kept" });
  assert.deepEqual((await flowing.read()).value, { type: "text-delta", id: "text", delta: "kept" });

  for (let index = 0; index < 100; index++) {
    const chunk = { type: "message-metadata", messageMetadata: { index } } as const;
    active.publish(chunk);
    assert.deepEqual((await flowing.read()).value, chunk);
  }
  assert.deepEqual((await stalled.read()).value, { type: "start", messageId: "assistant" });
  await assert.rejects(stalled.read(), /fell behind/);
  const resumed = active.subscribe().getReader();
  assert.deepEqual((await resumed.read()).value, { type: "start", messageId: "assistant" });
  assert.deepEqual((await resumed.read()).value, { type: "text-start", id: "text" });
  assert.deepEqual((await resumed.read()).value, { type: "text-delta", id: "text", delta: "kept" });
  active.close();
});

test("long token streams stay one materialized delta per active part", () => {
  const projection = new ActiveStreamProjection();
  projection.apply({ type: "start", messageId: "assistant" });
  projection.apply({ type: "text-start", id: "text" });
  for (let index = 0; index < 20_000; index += 1) {
    projection.apply({ type: "text-delta", id: "text", delta: "x" });
  }
  const snapshot = projection.snapshot();
  assert.equal(snapshot.length, 3);
  assert.equal((snapshot[2] as Extract<UIMessageChunk, { type: "text-delta" }>).delta.length, 20_000);
});

test("a detached duplicate is explicit while GET remains a resumable miss", async () => {
  const duplicate = detachedActiveRunResponse("run", 409);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.headers.get("x-agent-run-id"), "run");
  assert.equal(duplicate.headers.get("x-agent-run-state"), "active-detached");
  assert.deepEqual(await duplicate.json(), {
    code: "active_run_detached",
    message: "The logical Turn is active but its live stream is not on this process.",
  });

  const resume = detachedActiveRunResponse("run", 204);
  assert.equal(resume.status, 204);
  assert.equal(resume.headers.get("x-agent-run-id"), "run");
  assert.equal(resume.headers.get("x-agent-run-state"), "active-detached");
  assert.equal(resume.body, null);
});

test("disconnecting one subscriber never cancels the active Run stream", async () => {
  const active = new ActiveRunStream("session", "run", 1n);
  active.publish({ type: "start", messageId: "assistant" });
  const disconnected = active.subscribe().getReader();
  await disconnected.cancel();

  active.publish({ type: "text-start", id: "text" });
  active.publish({ type: "text-delta", id: "text", delta: "still running" });
  const resumed = active.subscribe().getReader();
  assert.deepEqual((await resumed.read()).value, { type: "start", messageId: "assistant" });
  assert.deepEqual((await resumed.read()).value, { type: "text-start", id: "text" });
  assert.deepEqual((await resumed.read()).value, { type: "text-delta", id: "text", delta: "still running" });
  active.close();
});

test("the official SDK consumer rebuilds the snapshot and continues the live text part", async () => {
  const active = new ActiveRunStream("session", "run", 1n);
  active.publish({ type: "start", messageId: "assistant", messageMetadata: { status: "streaming" } });
  active.publish({ type: "start-step" });
  active.publish({ type: "text-start", id: "text" });
  active.publish({ type: "text-delta", id: "text", delta: "snapshot" });

  const messages = readUIMessageStream<UIMessage>({ stream: active.subscribe() });
  queueMicrotask(() => {
    active.publish({ type: "text-delta", id: "text", delta: " + live" });
    active.publish({ type: "text-end", id: "text" });
    active.publish({ type: "finish", finishReason: "stop", messageMetadata: { status: "completed" } });
    active.close();
  });
  let final: UIMessage | undefined;
  for await (const message of messages) final = message;

  assert.equal(final?.id, "assistant");
  assert.deepEqual(final?.metadata, { status: "completed" });
  assert.equal(final?.parts[0]?.type, "step-start");
  assert.deepEqual(final?.parts[1], {
    type: "text",
    text: "snapshot + live",
    state: "done",
    providerMetadata: undefined,
  });
});

test("a Bash approval remains actionable after replaying the active snapshot", async () => {
  const projection = new ActiveStreamProjection();
  projection.apply({ type: "start", messageId: "assistant" });
  projection.apply({ type: "start-step" });
  projection.apply({
    type: "tool-input-available",
    toolCallId: "bash-call",
    toolName: "Bash",
    input: { command: "git status" },
    dynamic: true,
  });
  projection.apply({
    type: "tool-approval-request",
    approvalId: "approval",
    toolCallId: "bash-call",
    reason: "workspace write",
  });
  const replay = new ReadableStream<UIMessageChunk>({
    start(controller) {
      projection.snapshot().forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
  let final: UIMessage | undefined;
  for await (const message of readUIMessageStream<UIMessage>({ stream: replay })) final = message;

  assert.equal(final?.parts[0]?.type, "step-start");
  const approval = final?.parts[1] as
    | { type: string; toolName: string; toolCallId: string; state: string; input: unknown; approval?: unknown }
    | undefined;
  assert.deepEqual(
    approval && {
      type: approval.type,
      toolName: approval.toolName,
      toolCallId: approval.toolCallId,
      state: approval.state,
      input: approval.input,
      approval: approval.approval,
    },
    {
      type: "dynamic-tool",
      toolName: "Bash",
      toolCallId: "bash-call",
      state: "approval-requested",
      input: { command: "git status" },
      approval: { id: "approval", requestReason: "workspace write" },
    },
  );
});

test("reset arriving during snapshot replay reaches the SDK in wire order", async () => {
  const active = new ActiveRunStream("session", "run", 1n);
  const chunks: UIMessageChunk[] = [
    { type: "start", messageId: "assistant" },
    { type: "start-step" },
    { type: "text-start", id: "text" },
    { type: "text-delta", id: "text", delta: "discarded" },
  ];
  chunks.forEach((chunk) => active.publish(chunk));
  const stream = active.subscribe();
  active.publish({ type: "reset-step" });
  active.close();
  let final: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream })) final = message;
  assert.deepEqual(final, await finalMessage([...chunks, { type: "reset-step" }]));
});

test("a reader stalled during snapshot replay cannot accumulate an unlimited tail", async () => {
  const active = new ActiveRunStream("session", "run", 1n);
  active.publish({ type: "start", messageId: "assistant" });
  active.publish({ type: "text-start", id: "text" });
  const reader = active.subscribe().getReader();
  for (let index = 0; index < 10000; index++) active.publish({ type: "text-delta", id: "text", delta: "x" });
  active.close();
  await assert.rejects(async () => {
    while (!(await reader.read()).done) {
      /* drain the initial snapshot */
    }
  }, /fell behind/);
});
