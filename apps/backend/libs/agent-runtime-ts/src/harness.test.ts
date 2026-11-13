import assert from "node:assert/strict";
import { test } from "node:test";

import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { convertToModelMessages, isToolUIPart, readUIMessageStream, toUIMessageStream, type UIMessage } from "ai";

import { createBashTool } from "./bash.js";
import { createAgentHarness } from "./harness.js";
import { assembleInstructions } from "./instructions/index.js";
import { manifestsToTools } from "./manifest.js";
import { createToolApprovalPolicy } from "./policy.js";

const finish: LanguageModelV4StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
};
const text: LanguageModelV4StreamPart[] = [
  { type: "text-start", id: "answer" },
  { type: "text-delta", id: "answer", delta: "可以帮你写作和处理文件。" },
  { type: "text-end", id: "answer" },
];
function model(
  respond: (options: LanguageModelV4CallOptions) => LanguageModelV4StreamPart[] | Promise<LanguageModelV4StreamPart[]>,
): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("stream only");
    },
    doStream: async (options) => {
      const parts = await respond(options);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            for (const part of parts) controller.enqueue(part);
            controller.enqueue(finish);
            controller.close();
          },
        }),
      };
    },
  };
}
const request: UIMessage[] = [{ id: "user", role: "user", parts: [{ type: "text", text: "能帮我干啥" }] }];
async function consume(agent: ReturnType<typeof createAgentHarness>, messages = request) {
  const result = await agent.stream({ messages: await convertToModelMessages(messages) });
  let answer: UIMessage | undefined;
  for await (const item of readUIMessageStream({
    stream: toUIMessageStream({
      stream: result.stream,
      tools: agent.tools,
      originalMessages: messages,
      onError: (error) => String(error),
    }),
    terminateOnError: true,
    message: messages.at(-1)?.role === "assistant" ? messages.at(-1) : undefined,
  }))
    answer = item;
  assert.ok(answer);
  return answer;
}
for (const storage of ["cloud", "local"] as const) {
  test(`${storage}: capability question finishes without sandbox calls or synthetic user messages`, async () => {
    let calls = 0;
    const tools = manifestsToTools([
      createBashTool(async () => {
        throw new Error("must not inspect workspace");
      }),
    ]);
    const agent = createAgentHarness({
      mode: "normal",
      tools,
      instructions: assembleInstructions({ mode: "normal", storage, memories: [] }),
      model: model((options) => {
        calls++;
        assert.equal(options.prompt.filter((m) => m.role === "user").length, 1);
        assert.doesNotMatch(JSON.stringify(options.prompt), /external_workspace_changes/);
        return text;
      }),
    });
    const answer = await consume(agent);
    assert.equal(calls, 1);
    assert.equal(answer.parts.filter(isToolUIPart).length, 0);
  });
  test(`${storage}: one transient workspace notification and the same terminal ToolOutcome`, async () => {
    let calls = 0,
      consumed = false;
    const tools = manifestsToTools([
      createBashTool(async () => ({ exitCode: 7, stdout: "partial", stderr: "failed command" })),
    ]);
    const agent = createAgentHarness({
      mode: "normal",
      tools,
      toolApproval: createToolApprovalPolicy("normal"),
      instructions: assembleInstructions({ mode: "normal", storage, memories: [] }),
      workspace: { consumeChanges: () => (consumed ? [] : ((consumed = true), ["external.txt"])) },
      model: model((options) => {
        calls++;
        assert.equal(options.prompt.filter((m) => m.role === "user").length, 1);
        if (calls === 1) {
          assert.match(JSON.stringify(options.prompt), /external_workspace_changes/);
          return [{ type: "tool-call", toolCallId: "bash", toolName: "bash", input: '{"command":"false"}' }];
        }
        assert.doesNotMatch(JSON.stringify(options.prompt), /external_workspace_changes/);
        return text;
      }),
    });
    const answer = await consume(agent);
    const part = answer.parts.find(isToolUIPart);
    assert.equal(part?.toolMetadata?.agent && (part.toolMetadata.agent as { uiKind: string }).uiKind, "terminal");
    assert.equal(part?.state, "output-available");
    if (part?.state === "output-available")
      assert.deepEqual(part.output, {
        ok: false,
        status: "partial",
        data: { exitCode: 7, stdout: "partial", stderr: "failed command" },
        error: { code: "COMMAND_FAILED", message: "failed command", retryable: false, source: "bash" },
      });
    assert.equal(calls, 2);
  });
}
for (const approved of [false, true]) {
  test(`shared SDK approval resumes once without replaying the request: ${approved}`, async () => {
    let executions = 0,
      calls = 0;
    const manifest = createBashTool(async () => {
      executions++;
      return { exitCode: 0, stdout: "done", stderr: "" };
    });
    // A capability requiring consent uses the same SDK protocol on either host.
    const tools = manifestsToTools([manifest]);
    tools.bash = { ...tools.bash!, needsApproval: true };
    const agent = createAgentHarness({
      mode: "normal",
      tools,
      model: model(() =>
        ++calls === 1
          ? [{ type: "tool-call", toolCallId: "bash", toolName: "bash", input: '{"command":"echo done"}' }]
          : text,
      ),
    });
    const waiting = await consume(agent);
    const part = waiting.parts.find(isToolUIPart);
    assert.equal(part?.state, "approval-requested");
    assert.equal(executions, 0);
    if (part?.state !== "approval-requested") throw new Error("approval missing");
    Object.assign(part, { state: "approval-responded", approval: { ...part.approval, approved } });
    await consume(agent, [...request, waiting]);
    assert.equal(executions, approved ? 1 : 0);
    assert.equal(calls, 2);
  });
}
