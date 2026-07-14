/**
 * agent-runtime 的核心，就是一个状态机 —— 而且朴实无华。
 * ============================================================
 *
 * 外界常把 "agent 运行时" 想象成一套复杂的调度器 / 编排引擎 / 多角色协作框架。
 * 但把 Vercel AI SDK v7（`generateText` / `streamText` / `ToolLoopAgent`）的核心
 * 拆到底，会发现真相极其朴素：
 *
 *     一个 do…while 循环，反复地  "让模型说话 → 执行它要的工具 → 把结果喂回去"，
 *     直到模型不再要工具（自然收敛），或撞上一条停止条件（安全护栏）。
 *
 * 状态只有两样：`steps[]`（历史）和 `messagesForNextStep`（下一轮上下文）。
 * 没有隐藏的全局调度器，没有锁，没有角色扮演。这份文件是对 SDK 真实控制流
 * （`ai/dist/index.js` 内 generateText 的 `do…while`、streamText 的递归 `streamStep`）
 * 的精简重写，只保留骨架，用来讲清楚两件事：
 *
 *   1. 核心状态机长什么样（下面的 `runAgentLoop`）。
 *   2. 为什么它比朴素的 `while (true)` 手写 loop 强 —— 见文末 "特色" 小节，
 *      每一点都对应 SDK 在这个循环里预留的一个扩展点。
 *
 * 本文件是说明性文档，不参与编译；类型是就地最小声明，只为读起来是真 TS。
 */

// ── 领域最小模型（对应 SDK 的 content parts / step）────────────────────────

type ToolCall = { toolCallId: string; toolName: string; input: unknown };
type ToolResult = { toolCallId: string; toolName: string; output: unknown };
type ModelMessage = { role: "system" | "user" | "assistant" | "tool"; content: unknown };

/** 一次模型往返的结果：说了什么、要调哪些工具、为什么停。 */
type Step = {
  content: unknown[];
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool-calls" | "length";
  messages: ModelMessage[]; // 本步产生的、要拼进下一轮上下文的消息
};

// ── 循环的三个扩展点（这才是 SDK 的"特色"所在）─────────────────────────────

/**
 * 停止条件：纯函数 `(steps) => boolean`，可组合。
 * 默认只有 `stepCountIs(20)` 这一条护栏 —— 真正的收敛靠模型自己不再调工具。
 */
type StopCondition = (ctx: { steps: Step[] }) => boolean | Promise<boolean>;

/**
 * prepareStep：状态机的"转移函数钩子"。每一步开始前调用，可以按当前 steps
 * 动态改写这一步的 model / instructions / activeTools / toolChoice / 上下文。
 * 强制质量门（forced tool call）、按阶段收放工具集靠它。并发 tool-call 过滤在
 * 构造时挂的 middleware 里（generate 先产出、再过滤），不是 prepareStep。
 */
type PrepareStep<Ctx> = (ctx: {
  steps: Step[];
  stepNumber: number;
  messages: ModelMessage[];
  runtimeContext: Ctx;
}) => Partial<StepConfig<Ctx>> | undefined | Promise<Partial<StepConfig<Ctx>> | undefined>;

type StepConfig<Ctx> = {
  model: LanguageModel;
  instructions: string;
  activeTools: string[];
  toolChoice: "auto" | "none" | { toolName: string };
  messages: ModelMessage[];
  runtimeContext: Ctx;
};

type ModelResponse = {
  content: unknown[];
  toolCalls: ToolCall[];
  finishReason: Step["finishReason"];
};

type LanguageModel = {
  generate(req: {
    instructions: string;
    messages: ModelMessage[];
    tools: string[];
    toolChoice: StepConfig<unknown>["toolChoice"];
  }): Promise<ModelResponse>;
};

type LanguageModelMiddleware = {
  /** SDK 真实形态：先调 doGenerate() 拿模型产出，再过滤/改写 tool-call。 */
  wrapGenerate?: (opts: {
    doGenerate: () => Promise<ModelResponse>;
    doStream: () => Promise<{ stream: ReadableStream }>;
  }) => Promise<ModelResponse>;
  /** 流式路径：doStream() 后 pipeThrough TransformStream，边吐边滤。 */
  wrapStream?: (opts: {
    doGenerate: () => Promise<ModelResponse>;
    doStream: () => Promise<{ stream: ReadableStream }>;
  }) => Promise<{ stream: ReadableStream }>;
};

/** SDK doWrap：middleware.reduce 包 model；有 wrapGenerate 就走中间件，否则直调底层。 */
function wrapLanguageModel({
  model,
  middleware,
}: {
  model: LanguageModel;
  middleware?: LanguageModelMiddleware | LanguageModelMiddleware[];
}): LanguageModel {
  const chain = (middleware ? [middleware].flat() : []).slice().reverse();
  return chain.reduce<LanguageModel>((inner, mw) => ({
    async generate(req) {
      const doGenerate = () => inner.generate(req);
      const doStream = async () => ({ stream: new ReadableStream() });
      return mw.wrapGenerate ? mw.wrapGenerate({ doGenerate, doStream }) : doGenerate();
    },
  }), model);
}

/** 示例中间件（planToolOrderingMiddleware 的 wrapGenerate 形态）：模型先吐，我们再滤。 */
const planToolOrderingMiddleware: LanguageModelMiddleware = {
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate();
    const hasAskUser = result.toolCalls.some((c) => c.toolName === "ask_user");
    if (!hasAskUser) return result;
    return {
      ...result,
      toolCalls: result.toolCalls.filter(
        (c) => c.toolName !== "write_plan" && c.toolName !== "update_plan",
      ),
    };
  },
};

type Tool = {
  execute?: (input: unknown, ctx: { toolCallId: string }) => Promise<unknown>;
  /** 客户端工具（如 ask_user）没有 execute：循环在此让出，等外部回填。 */
};

type ToolApprovalPolicy = (ctx: { toolCall: ToolCall }) =>
  | "user-approval"
  | "not-applicable"
  | { type: "denied"; reason: string };

type AgentSettings<Ctx> = {
  /** 构造时已 wrapLanguageModel({ model, middleware }) 包过的 model。 */
  model: LanguageModel;
  instructions: string;
  tools: Record<string, Tool>;
  activeTools: string[];
  runtimeContext: Ctx;
  /** GenericToolApprovalFunction；循环内逐步 resolve，未放行则挂起。 */
  toolApproval?: ToolApprovalPolicy;
  /** 组合式护栏；缺省等价于 stepCountIs(20)。 */
  stopWhen?: StopCondition | StopCondition[];
  prepareStep?: PrepareStep<Ctx>;
  /** NoSuchToolError 时自愈：把跑偏的调用改写成期望的工具。 */
  repairToolCall?: (ctx: { toolCall: ToolCall; error: Error }) => ToolCall | null;
};

// ── 组合式停止条件（SDK: isStepCount / hasToolCall / isStopConditionMet）────

const stepCountIs =
  (n: number): StopCondition =>
  ({ steps }) =>
    steps.length >= n;

const hasToolCall =
  (name: string): StopCondition =>
  ({ steps }) =>
    steps.at(-1)?.toolCalls.some((c) => c.toolName === name) ?? false;

async function resolveToolApprovals(
  calls: ToolCall[],
  toolApproval?: ToolApprovalPolicy,
): Promise<ToolCall[]> {
  return calls; // SDK: 逐步 resolveToolApproval；user-approval 挂起，not-applicable 直接执行
}

async function isStopConditionMet(conditions: StopCondition[], steps: Step[]): Promise<boolean> {
  const results = await Promise.all(conditions.map((c) => c({ steps })));
  return results.some(Boolean);
}

// ══════════════════════════════════════════════════════════════════════════
//  核心状态机 —— 全部就在这里，一个 do…while
// ══════════════════════════════════════════════════════════════════════════

export async function runAgentLoop<Ctx>(settings: AgentSettings<Ctx>): Promise<Step[]> {
  const stopConditions = ([] as StopCondition[]).concat(
    settings.stopWhen ?? stepCountIs(20), // 没配停止条件时唯一的安全护栏
  );

  const steps: Step[] = [];
  let messagesForNextStep: ModelMessage[] = [];
  let instructions = settings.instructions;
  let runtimeContext = settings.runtimeContext;

  do {
    // ① 转移函数钩子：允许按已发生的 steps 动态改写这一步的配置。
    const patch = (await settings.prepareStep?.({
      steps,
      stepNumber: steps.length,
      messages: messagesForNextStep,
      runtimeContext,
    })) ?? {};
    const model = patch.model ?? settings.model;
    instructions = patch.instructions ?? instructions;
    runtimeContext = patch.runtimeContext ?? runtimeContext;
    const activeTools = patch.activeTools ?? settings.activeTools;
    const toolChoice = patch.toolChoice ?? "auto";
    const messages = patch.messages ?? messagesForNextStep;

    // ② model.generate → 内部 wrapGenerate：先 doGenerate()，再中间件过滤 tool-call
    const response = await model.generate({ instructions, messages, tools: activeTools, toolChoice });
    // ③ 审批门：toolApproval 策略逐步 resolve，未放行则挂起，不进 execute
    const approvedToolCalls = await resolveToolApprovals(response.toolCalls, settings.toolApproval);

    // ④ 执行放行后的工具调用。同一步的多个工具是并发的（Promise.all）
    const toolResults = await Promise.all(
      approvedToolCalls.map(async (call): Promise<ToolResult | null> => {
        const tool = settings.tools[call.toolName];
        if (!tool) {
          const repaired = settings.repairToolCall?.({
            toolCall: call,
            error: new Error("NoSuchToolError"),
          });
          if (!repaired) return null;
          call = repaired;
        }
        // 客户端工具（无 execute）：循环在此让出，由外部（浏览器）回填后再续跑。
        if (!settings.tools[call.toolName]?.execute) return null;
        const output = await settings.tools[call.toolName].execute!(call.input, {
          toolCallId: call.toolCallId,
        });
        return { toolCallId: call.toolCallId, toolName: call.toolName, output };
      }),
    );

    // ⑤ 沉淀历史 + 拼好下一轮上下文（assistant 的工具调用 + tool 的结果）。
    const step: Step = {
      content: response.content,
      toolCalls: response.toolCalls,
      finishReason: response.finishReason,
      messages: toResponseMessages(response, toolResults),
    };
    steps.push(step);
    messagesForNextStep = [...messages, ...step.messages];

    // ⑥ 是否继续？—— 这一行就是整台状态机的"转移条件"：
    //    只有当"模型这一步确实要了工具（且都已执行/让出）"时才可能续跑，
    //    并且没有撞上任何停止护栏。模型改口不调工具 => 自然收敛 => 退出。
    const executedAllToolCalls = step.toolCalls.length > 0;
    if (!executedAllToolCalls) break; // 自然终止：模型给出了最终答案
    if (await isStopConditionMet(stopConditions, steps)) break; // 安全护栏触顶
  } while (true);

  return steps;
}

function toResponseMessages(
  response: { toolCalls: ToolCall[] },
  toolResults: (ToolResult | null)[],
): ModelMessage[] {
  const assistant: ModelMessage = { role: "assistant", content: response.toolCalls };
  const tool: ModelMessage = { role: "tool", content: toolResults.filter(Boolean) };
  return [assistant, tool];
}

// ── ToolLoopAgent：只是"settings + 上面的循环"的极薄封装 ────────────────────
//    SDK 里的 ToolLoopAgent 本体就这么点东西：存配置、补默认 stopWhen、转调
//    streamText/generateText。它不是引擎，引擎就是上面那个 do…while。

export class ToolLoopAgent<Ctx> {
  constructor(settings: AgentSettings<Ctx> & { baseModel: LanguageModel; middleware?: LanguageModelMiddleware }) {
    this.settings = {
      ...settings,
      model: wrapLanguageModel({
        model: settings.baseModel,
        middleware: settings.middleware ?? planToolOrderingMiddleware,
      }),
    };
  }
  private readonly settings: AgentSettings<Ctx>;
  generate(): Promise<Step[]> {
    return runAgentLoop({ ...this.settings, stopWhen: this.settings.stopWhen ?? stepCountIs(20) });
  }
}

/*
 * 特色 —— 为什么这个 do…while 比朴素的手写 agent loop 强
 * ------------------------------------------------------------
 * 朴素实现往往是 `while (true) { const r = await model(); if (r.tool) run(r.tool); else break; }`，
 * 然后所有复杂度堆进 if/else。AI SDK 把复杂度收进循环的几个"缝"里，缝之外保持朴素：
 *
 * 1. 收敛权交给模型，护栏才是 stopWhen：终止的第一判据是"模型不再调工具"（步骤⑤），
 *    stopWhen 只是兜底。停止条件是可组合的纯函数（stepCountIs / hasToolCall / 自定义），
 *    而不是散落在循环里的魔法数字。
 *
 * 2. prepareStep = 每步可重配的转移函数：可按已发生的 steps 动态换 model、改
 *    instructions、收放 activeTools、强制 toolChoice。HTML 质量门靠它；并发 tool-call
 *    过滤走构造时挂的 middleware（generate 内先 doGenerate 再 wrapGenerate 过滤），
 *    不是 loop 里单独一步。
 *
 * 3. 同一步工具并发（步骤④的 Promise.all）：独立的 deliverable（md/html/image/video）
 *    在一步内并行跑完，而不是被循环串行化。
 *
 * 4. 客户端工具 = 协作让出点：像 ask_user 这类无 execute 的工具，循环在此优雅让出，
 *    等外部回填后自动续跑 —— 人类介入 (human-in-the-loop) 是循环的一等状态，不是补丁。
 *
 * 5. repairToolCall 自愈：模型调了不存在/跑偏的工具时，就地改写而非直接崩，
 *    让长任务更鲁棒。
 *
 * 6. 类型化的 runtimeContext / toolsContext 贯穿全程：依赖注入随循环流动，
 *    工具拿到的是强类型上下文，而非全局单例。
 *
 * 7. 流式与可恢复：真实实现里步骤②是递归的 `streamStep`，逐 token 吐官方 UIMessage
 *    part；断线只掉一个 SSE 订阅者，`resumeStream()` 可重新贴回。中间件
 *    (`wrapLanguageModel`) 与 AbortSignal 取消也都挂在同一条流水线上。
 *
 * 结论：agent-runtime 的"状态机"没有神秘之处 —— 状态是 steps[] 与下一轮上下文，
 * 转移是"要工具就续、不要就停"。它就是这么朴实无华，而它的全部力量来自把扩展点
 * 干净地留在这个朴素循环的接缝上，而不是把循环本身写复杂。
 */
