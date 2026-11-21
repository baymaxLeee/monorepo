import assert from "node:assert/strict";
import test from "node:test";

import type { UIMessage } from "ai";

import { mergeClientContinuation } from "./continuation.js";

type AnyUIMessage = UIMessage<unknown, any, any>;

const clientMetadata = {
  agent: {
    capability: "interaction",
    effect: "none",
    execution: "client",
    source: "builtin",
    trust: "closed",
    uiKind: "ask-user",
  },
};

function message(part: Record<string, unknown>): AnyUIMessage {
  return { id: "assistant", role: "assistant", parts: [part] } as AnyUIMessage;
}

function awaiting(overrides: Record<string, unknown> = {}): AnyUIMessage {
  return message({
    type: "tool-ask_user",
    toolCallId: "call",
    state: "input-available",
    input: {
      questions: [
        {
          id: "choice",
          question: "Choose",
          header: "Choice",
          options: [
            { label: "A", description: "First option" },
            { label: "B", description: "Second option" },
          ],
        },
      ],
    },
    toolMetadata: clientMetadata,
    ...overrides,
  });
}

function answer(overrides: Record<string, unknown> = {}): AnyUIMessage {
  return message({
    ...(awaiting().parts[0] as object),
    state: "output-available",
    output: {
      ok: true,
      status: "completed",
      data: { answers: { choice: { answers: ["A"] } } },
    },
    ...overrides,
  });
}

test("a valid client tool result replaces only the awaited tool state", () => {
  const merged = mergeClientContinuation(awaiting(), answer());
  assert.equal((merged.parts[0] as { state: string }).state, "output-available");
});

test("static and dynamic tool identity cannot be changed", () => {
  assert.throws(
    () => mergeClientContinuation(awaiting(), answer({ type: "dynamic-tool", toolName: "server_tool" })),
    /tool|overwrite|identity/i,
  );
});

for (const [name, override] of [
  ["input", { input: { questions: [] } }],
  ["tool metadata", { toolMetadata: { agent: { execution: "inline" } } }],
  ["provider execution", { providerExecuted: true }],
] as const) {
  test(`${name} is immutable in a client continuation`, () => {
    assert.throws(() => mergeClientContinuation(awaiting(), answer(override)), /tool|overwrite|immutable|client/i);
  });
}

test("server and provider executed tools cannot receive client supplied output", () => {
  const persisted = awaiting({
    type: "dynamic-tool",
    toolName: "server_tool",
    toolMetadata: { agent: { ...clientMetadata.agent, execution: "inline" } },
  });
  const client = answer({
    type: "dynamic-tool",
    toolName: "server_tool",
    toolMetadata: { agent: { ...clientMetadata.agent, execution: "inline" } },
  });
  assert.throws(() => mergeClientContinuation(persisted, client), /client|execution|tool/i);

  assert.throws(
    () => mergeClientContinuation(awaiting({ providerExecuted: true }), answer({ providerExecuted: true })),
    /provider|client|execution/i,
  );
});

test("approval response must preserve the server approval id and call identity", () => {
  const persisted = awaiting({ state: "approval-requested", approval: { id: "approval-one" } });
  const client = awaiting({
    state: "approval-responded",
    approval: { id: "approval-two", approved: true },
  });
  assert.throws(() => mergeClientContinuation(persisted, client), /approval|identity|overwrite/i);
});

test("one continuation cannot submit the same tool call twice", () => {
  const response = answer().parts[0]!;
  const client = { ...answer(), parts: [response, structuredClone(response)] } as AnyUIMessage;
  assert.throws(() => mergeClientContinuation(awaiting(), client), /duplicate|toolCallId/i);
});

test("preliminary client output is not a final answer", () => {
  assert.throws(() => mergeClientContinuation(awaiting(), answer({ preliminary: true })), /preliminary/i);
});

for (const [name, answers] of [
  ["unknown question", { invented: { answers: ["A"] } }],
  ["missing question", {}],
  ["multiple single choices", { choice: { answers: ["A", "B"] } }],
  ["empty answer", { choice: { answers: [" "] } }],
] as const) {
  test(`client answers reject ${name}`, () => {
    assert.throws(
      () =>
        mergeClientContinuation(awaiting(), answer({ output: { ok: true, status: "completed", data: { answers } } })),
      /answer|question|choice/i,
    );
  });
}

test("the browser cannot answer an automatic approval check", () => {
  const approval = { id: "automatic", isAutomatic: true };
  assert.throws(
    () =>
      mergeClientContinuation(
        awaiting({ state: "approval-requested", approval }),
        awaiting({ state: "approval-responded", approval: { ...approval, approved: true } }),
      ),
    /automatic/i,
  );
});

test("free-form answers are part of the ask_user protocol", () => {
  assert.doesNotThrow(() =>
    mergeClientContinuation(
      awaiting(),
      answer({
        output: { ok: true, status: "completed", data: { answers: { choice: { answers: ["another option"] } } } },
      }),
    ),
  );
});
