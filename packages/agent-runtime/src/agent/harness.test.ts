import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { convertToModelMessages, isToolUIPart, readUIMessageStream, toUIMessageStream, type UIMessage } from "ai";

import { assembleInstructions } from "../instructions/index.js";
import { createBashTool } from "../tools/bash.js";
import { manifestsToTools } from "../tools/manifest.js";
import { createToolApprovalPolicy } from "../tools/policy.js";
import type { ExecutionEnvironment } from "./execution-environment.js";
import { createAgentHarness } from "./harness.js";
import { FOLLOW_UP_PREEMPTED_FINISH_REASON } from "./run-input-control.js";
import { createAgentRunInputChannel } from "./steering.js";

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
function environment(storage: "cloud" | "local"): ExecutionEnvironment {
  return storage === "cloud"
    ? {
        location: "cloud",
        workspace: {
          root: "/workspace",
          access: "read-write",
          isolation: "ephemeral",
          persistence: "session",
          externalSources: "read-only",
        },
        network: { access: "environment", protocols: ["http", "https"] },
        process: { shell: true, lifetime: "command", backgroundServices: "unsupported" },
        deliverables: "session-file",
        approvals: "policy",
      }
    : {
        location: "local",
        workspace: {
          root: "/project",
          access: "read-write",
          isolation: "direct",
          persistence: "host",
          externalSources: "unavailable",
        },
        network: { access: "public", protocols: ["http", "https"] },
        process: { shell: true, lifetime: "command", backgroundServices: "unsupported" },
        deliverables: "workspace-reference",
        approvals: "auto",
      };
}
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
      environment: environment(storage),
      tools,
      instructions: assembleInstructions({ memories: [] }),
      model: model((options) => {
        calls++;
        assert.equal(options.prompt.filter((m) => m.role === "user").length, 1);
        assert.match(JSON.stringify(options.prompt), /execution_environment/);
        assert.match(JSON.stringify(options.prompt), new RegExp(environment(storage).workspace.root));
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
      environment: environment(storage),
      tools,
      toolApproval: createToolApprovalPolicy(),
      instructions: assembleInstructions({ memories: [] }),
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

test("a terminal sandbox failure ends the tool phase without planning a recovery path", async () => {
  let calls = 0;
  const tools = manifestsToTools([
    createBashTool(async () => {
      throw Object.assign(new Error("runtime-sandbox command failed: 422"), {
        service: "runtime-sandbox",
        status: 422,
        body: { message: "error: no such object: sandbox-run" },
      });
    }),
  ]);
  const agent = createAgentHarness({
    environment: environment("cloud"),
    tools,
    model: model((options) => {
      calls++;
      if (calls === 1) {
        assert.match(JSON.stringify(options.tools), /bash/);
        return [{ type: "tool-call", toolCallId: "bash-missing", toolName: "bash", input: '{"command":"pwd"}' }];
      }
      assert.doesNotMatch(JSON.stringify(options.tools ?? {}), /bash/);
      assert.match(JSON.stringify(options.prompt), /ended active execution/i);
      assert.match(JSON.stringify(options.prompt), /SANDBOX_UNAVAILABLE/);
      return text;
    }),
  });

  await consume(agent);
  assert.equal(calls, 2);
});
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
      environment: environment("cloud"),
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

test("SDK steering is delivered, streamed as an official part, and replayed into model history", async () => {
  const inputChannel = createAgentRunInputChannel();
  const outcomePromise = inputChannel.submit("改成巴黎德州。", {
    id: "steer-client-message",
    mode: "follow-up",
  });
  const agent = createAgentHarness({
    environment: environment("cloud"),
    inputChannel,
    tools: {},
    model: model((options) => {
      assert.deepEqual(
        options.prompt
          .filter((message) => message.role === "user")
          .map((message) => message.content)
          .map((content) =>
            typeof content === "string"
              ? content
              : content.map((part) => (part.type === "text" ? part.text : "")).join(""),
          ),
        ["能帮我干啥", "改成巴黎德州。"],
      );
      return text;
    }),
  });
  const result = await agent.stream({
    messages: await convertToModelMessages(request),
    experimental_steering: inputChannel.steering,
  });
  let answer: UIMessage | undefined;
  for await (const item of readUIMessageStream({
    stream: toUIMessageStream({ stream: result.stream, tools: agent.tools, originalMessages: request }),
    terminateOnError: true,
  }))
    answer = item;

  assert.ok(answer);
  assert.deepEqual(await outcomePromise, {
    type: "delivered",
    id: "steer-client-message",
    message: { role: "user", content: "改成巴黎德州。" },
    stepNumber: 0,
  });
  assert.deepEqual(answer.parts[0], {
    type: "steering-message",
    id: "steer-client-message",
    parts: [{ type: "text", text: "改成巴黎德州。" }],
  });
  assert.equal(JSON.stringify(await convertToModelMessages([...request, answer])).includes("改成巴黎德州。"), true);
});

test("next-turn waits for the active task's final answer before entering model history", async () => {
  const inputChannel = createAgentRunInputChannel();
  const outcomePromise = inputChannel.submit("完成后再总结风险。", {
    id: "next-turn-client-message",
    mode: "next-turn",
  });
  let calls = 0;
  const agent = createAgentHarness({
    environment: environment("cloud"),
    inputChannel,
    tools: {},
    model: model((options) => {
      calls += 1;
      const prompt = JSON.stringify(options.prompt);
      if (calls === 1) assert.doesNotMatch(prompt, /完成后再总结风险/);
      else assert.match(prompt, /完成后再总结风险/);
      return text;
    }),
  });
  const result = await agent.stream({
    messages: await convertToModelMessages(request),
    experimental_steering: inputChannel.steering,
  });
  for await (const _ of result.fullStream) {
    // Consume the run so the queued task reaches its post-answer boundary.
  }

  assert.equal(calls, 2);
  assert.deepEqual(await outcomePromise, {
    type: "delivered",
    id: "next-turn-client-message",
    message: { role: "user", content: "完成后再总结风险。" },
    stepNumber: 1,
  });
});

test("stored-response continuation keeps steering sent during a tool in the next step", async () => {
  let releaseTool: () => void = () => {};
  let markToolStarted: () => void = () => {};
  const toolStarted = new Promise<void>((resolve) => {
    markToolStarted = resolve;
  });
  const toolRelease = new Promise<void>((resolve) => {
    releaseTool = resolve;
  });
  let executions = 0;
  const tools = manifestsToTools([
    createBashTool(async () => {
      executions++;
      markToolStarted();
      await toolRelease;
      return { exitCode: 0, stdout: "done", stderr: "" };
    }),
  ]);
  let calls = 0;
  const inputChannel = createAgentRunInputChannel();
  const agent = createAgentHarness({
    environment: environment("cloud"),
    inputChannel,
    tools,
    model: model((options) => {
      calls++;
      if (calls === 1) {
        return [{ type: "tool-call", toolCallId: "bash", toolName: "bash", input: '{"command":"echo done"}' }];
      }
      if (calls === 2) {
        const userMessages = options.prompt.filter((message) => message.role === "user");
        const systemMessages = options.prompt.filter((message) => message.role === "system");
        const prompt = JSON.stringify(options.prompt);
        assert.equal(JSON.stringify(userMessages.at(-1)?.content).includes("继续检查日志"), true);
        assert.doesNotMatch(JSON.stringify(systemMessages), /继续检查日志/);
        assert.match(prompt, /follow_up_reorientation/);
        assert.match(prompt, /keep completed work and unaffected pending work/);
        assert.match(prompt, /Extra context does not by itself pause, cancel, reorder, or replace the original task/);
        assert.match(prompt, /user-visible text before any further tool execution/);
        return [
          { type: "tool-call", toolCallId: "bash-after-steer", toolName: "bash", input: '{"command":"echo next"}' },
        ];
      }
      assert.doesNotMatch(JSON.stringify(options.prompt), /follow_up_reorientation/);
      return text;
    }),
    continuation: ({ steps, messages }) => ({
      providerOptions: { openai: { previousResponseId: "response-1" } },
      messages:
        steps.length > 0
          ? (steps.at(-1)?.response.messages.filter((message) => message.role === "tool") ?? [])
          : messages,
    }),
  });
  const result = await agent.stream({
    messages: await convertToModelMessages(request),
    experimental_steering: inputChannel.steering,
  });
  const consumed = (async () => {
    for await (const _ of result.fullStream) {
      // Consuming drives the model/tool loop.
    }
  })();
  await toolStarted;
  const outcomePromise = inputChannel.submit("继续检查日志", { id: "mid-tool-steer", mode: "follow-up" });
  releaseTool();
  await consumed;
  assert.deepEqual(await outcomePromise, {
    type: "delivered",
    id: "mid-tool-steer",
    message: { role: "user", content: "继续检查日志" },
    stepNumber: 1,
  });
  assert.equal(calls, 3);
  assert.equal(executions, 1);
});

test("follow-up arriving during sampling prevents later tool calls from the stale response", async () => {
  let releaseSampling: () => void = () => {};
  let markSamplingStarted: () => void = () => {};
  const samplingStarted = new Promise<void>((resolve) => {
    markSamplingStarted = resolve;
  });
  const samplingRelease = new Promise<void>((resolve) => {
    releaseSampling = resolve;
  });
  let calls = 0;
  let executions = 0;
  const tools = manifestsToTools([
    createBashTool(async () => {
      executions++;
      return { exitCode: 0, stdout: "stale", stderr: "" };
    }),
  ]);
  const inputChannel = createAgentRunInputChannel();
  const agent = createAgentHarness({
    environment: environment("cloud"),
    inputChannel,
    tools,
    model: {
      specificationVersion: "v4",
      provider: "test",
      modelId: "test",
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error("stream only");
      },
      doStream: async (options) => {
        calls++;
        if (calls === 1) {
          return {
            stream: new ReadableStream<LanguageModelV4StreamPart>({
              start(controller) {
                controller.enqueue({ type: "stream-start", warnings: [] });
                controller.enqueue({ type: "response-metadata", id: "response-before-follow-up" });
                markSamplingStarted();
                void samplingRelease.then(() => {
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: "stale-bash",
                    toolName: "bash",
                    input: '{"command":"echo stale"}',
                  });
                  controller.enqueue(finish);
                  controller.close();
                });
              },
            }),
          };
        }
        assert.match(JSON.stringify(options.prompt), /先告诉我 npm 是什么/);
        assert.match(JSON.stringify(options.prompt), /execution-denied/);
        assert.equal(
          (options.providerOptions?.openai as { previousResponseId?: string } | undefined)?.previousResponseId,
          "response-before-follow-up",
        );
        return model(() => text).doStream(options);
      },
    },
    continuation: ({ steps }) => {
      const lastStep = steps.at(-1);
      return lastStep?.rawFinishReason === FOLLOW_UP_PREEMPTED_FINISH_REASON && lastStep.response.id
        ? {
            providerOptions: { openai: { previousResponseId: lastStep.response.id } },
            messages: [],
          }
        : {};
    },
  });
  const result = await agent.stream({
    messages: await convertToModelMessages(request),
    experimental_steering: inputChannel.steering,
  });
  const consumed = (async () => {
    for await (const _ of result.fullStream) {
      // Consuming drives the model/tool loop.
    }
  })();

  await samplingStarted;
  const outcomePromise = inputChannel.submit("先告诉我 npm 是什么，再继续任务", {
    id: "sampling-follow-up",
    mode: "follow-up",
  });
  releaseSampling();
  await consumed;

  assert.equal(executions, 0);
  assert.equal(calls, 2);
  assert.deepEqual(await outcomePromise, {
    type: "delivered",
    id: "sampling-follow-up",
    message: { role: "user", content: "先告诉我 npm 是什么，再继续任务" },
    stepNumber: 1,
  });
});

test("follow-up admitted between prepareStep and the sampling watcher still preempts the stale response", async () => {
  let executions = 0;
  let calls = 0;
  let outcomePromise: Promise<unknown> | undefined;
  const inputChannel = createAgentRunInputChannel();
  const submitInSamplingGap: LanguageModelV4Middleware = {
    specificationVersion: "v4",
    wrapStream: async ({ doStream }) => {
      if (!outcomePromise) {
        outcomePromise = inputChannel.submit("先回答新问题，再继续", {
          id: "follow-up-in-sampling-gap",
          mode: "follow-up",
        });
      }
      return doStream();
    },
  };
  const agent = createAgentHarness({
    environment: environment("cloud"),
    inputChannel,
    middleware: [submitInSamplingGap],
    tools: manifestsToTools([
      createBashTool(async () => {
        executions++;
        return { exitCode: 0, stdout: "stale", stderr: "" };
      }),
    ]),
    model: model((options) => {
      calls++;
      if (calls === 1) {
        return [{ type: "tool-call", toolCallId: "stale-gap-tool", toolName: "bash", input: "{}" }];
      }
      assert.match(JSON.stringify(options.prompt), /先回答新问题，再继续/);
      return text;
    }),
  });

  const result = await agent.stream({
    messages: await convertToModelMessages(request),
    experimental_steering: inputChannel.steering,
  });
  for await (const _ of result.fullStream) {
    // Consuming drives both the preempted sampling and its follow-up.
  }

  assert.ok(outcomePromise);
  assert.equal(executions, 0);
  assert.equal(calls, 2);
  assert.deepEqual(await outcomePromise, {
    type: "delivered",
    id: "follow-up-in-sampling-gap",
    message: { role: "user", content: "先回答新问题，再继续" },
    stepNumber: 1,
  });
});

test("follow-up response gate blocks a tool-only step until the model emits visible text", async () => {
  const commands: string[] = [];
  const tools = manifestsToTools([
    createBashTool(async ({ command }) => {
      commands.push(command);
      return { exitCode: 0, stdout: "done", stderr: "" };
    }),
  ]);
  const inputChannel = createAgentRunInputChannel();
  const outcomePromise = inputChannel.submit("先告诉我 npm 是什么，再继续任务", {
    id: "answer-before-tools",
    mode: "follow-up",
  });
  let calls = 0;
  const agent = createAgentHarness({
    environment: environment("cloud"),
    inputChannel,
    tools,
    model: model((options) => {
      calls++;
      if (calls === 1) {
        assert.match(JSON.stringify(options.prompt), /先告诉我 npm 是什么/);
        return [
          {
            type: "tool-call",
            toolCallId: "tool-before-answer",
            toolName: "bash",
            input: '{"command":"echo must-not-run"}',
          },
        ];
      }
      if (calls === 2) {
        assert.match(JSON.stringify(options.prompt), /FOLLOW_UP_RESPONSE_REQUIRED/);
        return [
          { type: "text-start", id: "npm-answer" },
          {
            type: "text-delta",
            id: "npm-answer",
            delta: "npm 是 Node.js 的包管理器；下面继续原调研。",
          },
          { type: "text-end", id: "npm-answer" },
          {
            type: "tool-call",
            toolCallId: "tool-after-answer",
            toolName: "bash",
            input: '{"command":"echo allowed"}',
          },
        ];
      }
      return text;
    }),
  });

  const result = await agent.stream({
    messages: await convertToModelMessages(request),
    experimental_steering: inputChannel.steering,
  });
  for await (const _ of result.fullStream) {
    // Consuming drives the response gate and the following tool continuation.
  }

  assert.deepEqual(commands, ["echo allowed"]);
  assert.equal(calls, 3);
  assert.deepEqual(await outcomePromise, {
    type: "delivered",
    id: "answer-before-tools",
    message: { role: "user", content: "先告诉我 npm 是什么，再继续任务" },
    stepNumber: 0,
  });
});

test("next-turn arriving during sampling does not preempt the active task", async () => {
  let releaseSampling: () => void = () => {};
  let markSamplingStarted: () => void = () => {};
  const samplingStarted = new Promise<void>((resolve) => {
    markSamplingStarted = resolve;
  });
  const samplingRelease = new Promise<void>((resolve) => {
    releaseSampling = resolve;
  });
  let calls = 0;
  let executions = 0;
  const tools = manifestsToTools([
    createBashTool(async () => {
      executions++;
      return { exitCode: 0, stdout: "current task", stderr: "" };
    }),
  ]);
  const inputChannel = createAgentRunInputChannel();
  const agent = createAgentHarness({
    environment: environment("cloud"),
    inputChannel,
    tools,
    model: {
      specificationVersion: "v4",
      provider: "test",
      modelId: "test",
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error("stream only");
      },
      doStream: async (options) => {
        calls++;
        if (calls === 1) {
          return {
            stream: new ReadableStream<LanguageModelV4StreamPart>({
              start(controller) {
                controller.enqueue({ type: "stream-start", warnings: [] });
                markSamplingStarted();
                void samplingRelease.then(() => {
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: "current-task-tool",
                    toolName: "bash",
                    input: '{"command":"echo current"}',
                  });
                  controller.enqueue(finish);
                  controller.close();
                });
              },
            }),
          };
        }
        const prompt = JSON.stringify(options.prompt);
        if (calls === 2) assert.doesNotMatch(prompt, /完成后总结/);
        if (calls === 3) assert.match(prompt, /完成后总结/);
        return model(() => text).doStream(options);
      },
    },
  });
  const result = await agent.stream({
    messages: await convertToModelMessages(request),
    experimental_steering: inputChannel.steering,
  });
  const consumed = (async () => {
    for await (const _ of result.fullStream) {
      // Consuming drives the current task and then the queued task.
    }
  })();

  await samplingStarted;
  const outcomePromise = inputChannel.submit("完成后总结", {
    id: "queued-during-sampling",
    mode: "next-turn",
  });
  releaseSampling();
  await consumed;

  assert.equal(executions, 1);
  assert.equal(calls, 3);
  assert.deepEqual(await outcomePromise, {
    type: "delivered",
    id: "queued-during-sampling",
    message: { role: "user", content: "完成后总结" },
    stepNumber: 2,
  });
});
