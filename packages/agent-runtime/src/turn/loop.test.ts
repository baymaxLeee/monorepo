import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { convertToModelMessages, isToolUIPart, readUIMessageStream, toUIMessageStream, tool, type UIMessage } from "ai";
import { z } from "zod";

import type { ExecutionEnvironment } from "../context/environment.js";
import { appendWorkspaceChangeEvent, attachExecutionEnvironment } from "../context/environment.js";
import { assembleInstructions } from "../context/instructions/index.js";
import { CommandSessions } from "../execution/command-sessions.js";
import type { OrchestratedCommandResult } from "../execution/orchestrator.js";
import type { BashCommandArgs } from "../execution/shell-tools.js";
import { createBashTool } from "../execution/shell-tools.js";

function execTool(launch: (args: BashCommandArgs) => Promise<OrchestratedCommandResult>) {
  return createBashTool(new CommandSessions(), launch);
}
import { manifestsToTools } from "../tools/manifest.js";
import { isToolOutcome } from "../tools/outcome.js";
import { createRuntimeInputQueue } from "./input-queue.js";
import { createAgentLoop } from "./loop.js";

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
function commandResult(exitCode: number, stdout: string, stderr: string): OrchestratedCommandResult {
  return { stdout, stderr, termination: { type: "exit", exitCode } };
}
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
        permissions: { profileId: ":workspace", enforcement: "managed", approvalPolicy: "on-request" },
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
        permissions: { profileId: ":workspace", enforcement: "managed", approvalPolicy: "on-request" },
      };
}
async function consume(agent: ReturnType<typeof createAgentLoop>, messages = request) {
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

test("an interactive turn continues through the twentieth tool step until the model answers", async () => {
  let calls = 0;
  let executed = 0;
  const agent = createAgentLoop({
    tools: { check: tool({ inputSchema: z.object({}), execute: async () => ++executed }) },
    model: model(() =>
      ++calls <= 21 ? [{ type: "tool-call", toolCallId: String(calls), toolName: "check", input: "{}" }] : text,
    ),
  });
  const answer = await consume(agent);
  assert.equal(executed, 21);
  assert.equal(calls, 22);
  assert.ok(answer.parts.some((part) => part.type === "text" && part.text.includes("处理文件")));
});

test("preserves every tool call emitted by one model response", async () => {
  const executed: string[] = [];
  let calls = 0;
  const agent = createAgentLoop({
    tools: {
      load_skill: tool({
        inputSchema: z.object({}),
        execute: async () => {
          executed.push("load_skill");
          return "loaded";
        },
      }),
      web_fetch: tool({
        inputSchema: z.object({}),
        execute: async () => {
          executed.push("web_fetch");
          return "fetched";
        },
      }),
    },
    model: model(() =>
      ++calls === 1
        ? [
            { type: "tool-call", toolCallId: "skill", toolName: "load_skill", input: "{}" },
            { type: "tool-call", toolCallId: "fetch", toolName: "web_fetch", input: "{}" },
          ]
        : text,
    ),
  });

  await consume(agent);
  assert.deepEqual(executed.sort(), ["load_skill", "web_fetch"]);
});
for (const storage of ["cloud", "local"] as const) {
  test(`${storage}: capability question finishes without sandbox calls or synthetic user messages`, async () => {
    let calls = 0;
    const tools = manifestsToTools([
      execTool(async () => {
        throw new Error("must not inspect workspace");
      }),
    ]);
    const agent = createAgentLoop({
      tools,
      instructions: attachExecutionEnvironment(assembleInstructions({ memories: [] }), environment(storage)),
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
  test(`${storage}: records one workspace event in model history and preserves the terminal ToolOutcome`, async () => {
    let calls = 0,
      consumed = false;
    const tools = manifestsToTools([execTool(async () => commandResult(7, "partial", "failed command"))]);
    const agent = createAgentLoop({
      tools,
      instructions: attachExecutionEnvironment(assembleInstructions({ memories: [] }), environment(storage)),
      prepareStep: ({ messages }) => {
        const changes = consumed ? [] : ((consumed = true), ["external.txt"]);
        return changes.length > 0 ? { messages: appendWorkspaceChangeEvent(messages, changes) } : {};
      },
      model: model((options) => {
        calls++;
        assert.equal(JSON.stringify(options.prompt).match(/external_workspace_changes/g)?.length ?? 0, 0);
        assert.equal(JSON.stringify(options.prompt).match(/runtime_context/g)?.length, 2);
        if (calls === 1) {
          assert.match(JSON.stringify(options.prompt), /external\.txt/);
          return [{ type: "tool-call", toolCallId: "bash", toolName: "bash", input: '{"command":"false"}' }];
        }
        assert.match(JSON.stringify(options.prompt), /external\.txt/);
        return text;
      }),
    });
    const answer = await consume(agent);
    const part = answer.parts.find(isToolUIPart);
    assert.equal(part?.toolMetadata?.agent && (part.toolMetadata.agent as { uiKind: string }).uiKind, "terminal");
    assert.equal(part?.state, "output-available");
    if (part?.state === "output-available") {
      assert.ok(isToolOutcome(part.output) && part.output.status === "completed");
      assert.match(JSON.stringify(part.output.data), /"exit_code":7/);
      assert.match(JSON.stringify(part.output.data), /partialfailed command/);
    }
    assert.equal(calls, 2);
  });
}

test("a terminal sandbox failure remains visible without hiding the tool catalog", async () => {
  let calls = 0;
  const tools = manifestsToTools([
    execTool(async () => {
      throw Object.assign(new Error("runtime-sandbox command failed: 422"), {
        service: "runtime-sandbox",
        status: 422,
        body: { message: "error: no such object: sandbox-run" },
      });
    }),
  ]);
  const agent = createAgentLoop({
    tools,
    model: model((options) => {
      calls++;
      if (calls === 1) {
        assert.match(JSON.stringify(options.tools), /bash/);
        return [{ type: "tool-call", toolCallId: "bash-missing", toolName: "bash", input: '{"command":"pwd"}' }];
      }
      assert.match(JSON.stringify(options.tools ?? {}), /bash/);
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
    const manifest = execTool(async () => {
      executions++;
      return commandResult(0, "done", "");
    });
    // A capability requiring consent uses the same SDK protocol on either host.
    const tools = manifestsToTools([manifest]);
    tools.bash = { ...tools.bash!, needsApproval: true };
    const agent = createAgentLoop({
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
  const inputChannel = createRuntimeInputQueue();
  const outcomePromise = inputChannel.submit("改成巴黎德州。", {
    id: "steer-client-message",
    mode: "follow-up",
  });
  const agent = createAgentLoop({
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
  const inputChannel = createRuntimeInputQueue();
  const outcomePromise = inputChannel.submit("完成后再总结风险。", {
    id: "next-turn-client-message",
    mode: "next-turn",
  });
  let calls = 0;
  const agent = createAgentLoop({
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
    execTool(async () => {
      executions++;
      markToolStarted();
      await toolRelease;
      return commandResult(0, "done", "");
    }),
  ]);
  let calls = 0;
  const inputChannel = createRuntimeInputQueue();
  const agent = createAgentLoop({
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
        assert.doesNotMatch(prompt, /follow_up_reorientation/);
        return [
          { type: "tool-call", toolCallId: "bash-after-steer", toolName: "bash", input: '{"command":"echo next"}' },
        ];
      }
      return text;
    }),
    prepareStep: ({ steps, messages }) => ({
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
  assert.equal(executions, 2);
});

test("follow-up arriving during sampling preserves the current response and its tool calls", async () => {
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
    execTool(async () => {
      executions++;
      return commandResult(0, "stale", "");
    }),
  ]);
  const inputChannel = createRuntimeInputQueue();
  const agent = createAgentLoop({
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
        assert.match(JSON.stringify(options.prompt), /stale/);
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

  assert.equal(executions, 1);
  assert.equal(calls, 2);
  assert.deepEqual(await outcomePromise, {
    type: "delivered",
    id: "sampling-follow-up",
    message: { role: "user", content: "先告诉我 npm 是什么，再继续任务" },
    stepNumber: 1,
  });
});

test("follow-up admitted while sampling still preserves the sampled tool call", async () => {
  let executions = 0;
  let calls = 0;
  let outcomePromise: Promise<unknown> | undefined;
  const inputChannel = createRuntimeInputQueue();
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
  const agent = createAgentLoop({
    middleware: [submitInSamplingGap],
    tools: manifestsToTools([
      execTool(async () => {
        executions++;
        return commandResult(0, "stale", "");
      }),
    ]),
    model: model((options) => {
      calls++;
      if (calls === 1) {
        return [
          {
            type: "tool-call",
            toolCallId: "current-gap-tool",
            toolName: "bash",
            input: '{"command":"echo current"}',
          },
        ];
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
    // Consuming drives both the current sampling and its follow-up.
  }

  assert.ok(outcomePromise);
  assert.equal(executions, 1);
  assert.equal(calls, 2);
  assert.deepEqual(await outcomePromise, {
    type: "delivered",
    id: "follow-up-in-sampling-gap",
    message: { role: "user", content: "先回答新问题，再继续" },
    stepNumber: 1,
  });
});

test("follow-up relies on the SDK loop and allows the model to continue with a tool-only step", async () => {
  const commands: string[] = [];
  const tools = manifestsToTools([
    execTool(async ({ command }) => {
      commands.push(command);
      return commandResult(0, "done", "");
    }),
  ]);
  const inputChannel = createRuntimeInputQueue();
  const outcomePromise = inputChannel.submit("先告诉我 npm 是什么，再继续任务", {
    id: "answer-before-tools",
    mode: "follow-up",
  });
  let calls = 0;
  const agent = createAgentLoop({
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
            input: '{"command":"echo continue"}',
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
    // Consuming drives the tool continuation selected by the model.
  }

  assert.deepEqual(commands, ["echo continue"]);
  assert.equal(calls, 2);
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
    execTool(async () => {
      executions++;
      return commandResult(0, "current task", "");
    }),
  ]);
  const inputChannel = createRuntimeInputQueue();
  const agent = createAgentLoop({
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

test("SDK sampling after compaction keeps the initial request and correction but drops synthetic user input", async () => {
  let samples = 0;
  let finalPrompt = "";
  const agent = createAgentLoop({
    tools: {
      read: tool({ inputSchema: z.object({}), execute: async () => "large result ".repeat(1500) }),
    },
    contextLimits: { contextWindow: 18_000, maxOutputTokens: 1000 },
    prepareStep: ({ messages, stepNumber }) =>
      stepNumber === 0
        ? {
            messages: appendWorkspaceChangeEvent(messages, ["temporary-event.txt"]),
          }
        : {},
    model: model((options) => {
      if (!options.tools?.length) return text;
      if (++samples === 1) return [{ type: "tool-call", toolCallId: "r", toolName: "read", input: "{}" }];
      finalPrompt = JSON.stringify(options.prompt);
      return text;
    }),
  });
  await consume(agent, [
    { id: "original", role: "user", parts: [{ type: "text", text: "Only edit the first directory." }] },
    { id: "correction", role: "user", parts: [{ type: "text", text: "Use the second directory now." }] },
  ]);
  assert.equal(samples, 2);
  assert.match(finalPrompt, /Only edit the first directory\..*compacted_history.*Use the second directory now\./s);
  assert.doesNotMatch(finalPrompt, /temporary-event\.txt|large result/);
});
