# Agent Tool Outcome：错误作为值的统一工具协议

## 1. 状态

- 文档类型：已执行实现计划
- 执行状态：核心迁移已完成；全量 lint 被无关既有诊断阻塞，受影响范围 lint/build 均通过
- 目标阶段：Demo，直接迁移，不保留旧输出兼容层
- 影响范围：Chat Agent Runtime、全部模型可见工具、Executor 长任务错误链路、Chat UI 工具卡片、运行观测与相关 ADR
- 核心原则：工具失败是 Agent 的一次正常 observation；Agent Runtime 负责完整采集事实，ToolLoopAgent 的 LLM 负责决定退出、调整输入、换工具或再次调用工具

## 2. 背景与问题

当前工具没有统一的结果协议：部分工具返回 `{ ok: false }`，部分抛出异常，部分只返回状态字符串，部分在内部吞掉异常后降级。`manifest.ts` 目前只给已经创建的 AI SDK Tool 追加 metadata，既不拥有 `outputSchema`，也不包裹 `execute`，因此无法保证所有工具把相同质量的失败信息交给 Agent Loop。

这造成了几类系统性问题：

1. `TransportError` 的真实响应在 `body`，但抛出后交给 LLM 的通常只有 `service request failed: 422`，业务错误码、Provider 原因和可修正字段丢失。
2. 非字符串错误在持久化或 UI 中可能退化成 `[object Object]`。
3. 图片批量生成只报告失败数量，没有逐项原因；视频失败曾只报告 `0/12`，没有失败镜头和 Provider 错误。
4. 某些工具把失败作为正常输出，某些工具使用 AI SDK `tool-error`，生命周期、Trace 和前端只能靠工具名或 `ok:false` 猜测语义。
5. 工具或 Workflow 内部重试对 LLM 和用户不可见；当重试仍失败时，Agent 无法知道之前尝试了什么，也无法基于完整事实选择更好的路径。
6. AsyncGenerator 工具的异常可能发生在迭代期间，仅包裹最外层 `execute()` 调用无法捕获。
7. MCP/Skill 扩展通过 Catalog 注入原始 ToolSet，绕过内置工具约定，无法保证错误质量。

## 3. 设计依据

### 3.1 Go 的错误模型

采用 Go `(value, err)` 的核心思想，而不是机械复制语法：

- 错误属于正常返回空间，调用方必须观察并作出决定。
- 部分结果与错误可以同时存在，例如五张图片成功三张、两张失败。
- 取消和控制流不应伪装成普通业务错误；类似 `context.Canceled`，必须向上传播并停止当前工作。
- Runtime/协议 invariant 与工具可解释失败分层处理，避免把损坏的调用协议伪装成可重试业务错误。

### 3.2 AI SDK v7

仓库实际使用 `ai@7.0.26`，以本地安装内容为准，而不是依赖版本滞后的外部示例：

- `node_modules/@ai-sdk/provider-utils/src/types/tool-execute-function.ts` 中 `ToolExecuteFunction` 原生支持普通返回值、PromiseLike 和 AsyncIterable。
- `node_modules/@ai-sdk/provider-utils/src/types/content-part.ts` 中 `ToolResultOutput` 原生支持 `error-text` / `error-json`；`node_modules/ai/src/prompt/create-tool-model-output.ts` 证明 `toModelOutput` 只负责模型消息转换，不改变 UIMessage 中保存的原始工具 output。
- `node_modules/ai/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx` 说明抛出的执行异常会成为 `tool-error`，但不要求业务失败必须抛出；结构化失败值仍是合法 tool result，并会进入后续模型轮次。
- `node_modules/ai/docs/04-ai-sdk-ui/03-chatbot-tool-usage.mdx` 的官方工具 part 状态继续作为传输层状态使用。本方案不增加自定义 `data-*` part。
- ToolLoopAgent 继续拥有循环、并发、step 边界和下一轮模型调用；不新增手写 Agent Loop 或 Runtime 重试调度器。

### 3.3 行业实现

- MCP 将 API 失败、输入校验和业务失败作为 `CallToolResult.isError=true` 返回，使模型能够读取原因并自我修正；未知工具和协议损坏才属于协议错误。
- Codex Agent Loop 将每次工具输出追加到下一次推理输入，模型基于 observation 继续尝试或结束。
- Claude/MCP Tool Result 同样区分普通工具失败与取消/协议失败。
- Cursor/Codex 的用户可见重试表现为新的工具调用，而不是在 Agent Harness 中生成一条用户无法理解的隐藏执行链。

结论：沿用 AI SDK 原生 Loop 和 UIMessage tool parts，只统一工具输出值与边界异常，不发明第二套编排协议。

## 4. 目标与非目标

### 4.1 目标

1. 所有模型可见工具拥有统一、可判别、可验证的成功/进度/部分成功/失败输出。
2. 任何工具执行失败都向 LLM 提供足够的真实、安全、可行动信息。
3. LLM 始终获得失败 observation，并自主决定停止、解释、修改输入、换工具或发起新的可见工具调用。
4. 长任务继续在原生 tool part 中流式展示进度，终态失败不再让整个 Run 失败。
5. Trace、日志和 UI 对相同 outcome 使用一致解释。
6. 删除工具层和业务 Workflow 中会重新执行有副作用操作的隐藏重试。

### 4.2 非目标

- 不重写 ToolLoopAgent，不实现自定义循环、调度器或多 Agent 角色系统。
- 不新增自定义 SSE 或 `data-*` part。
- 不新增数据库表或迁移。
- 不把密钥、认证头、完整 stack、原始二进制或超大 Provider 响应交给模型。
- 不在本任务中引入测试框架或测试文件；Demo 阶段以类型检查、构建和手工验收为准。
- 不兼容旧的工具输出 Wire Shape，不回填历史消息；必要时重置 Demo 会话数据。

## 5. 统一公共协议

### 5.1 ToolOutcome

所有工具的最终公开输出遵循同一个判别联合：

```ts
type ToolOutcome<TData, TProgress = never> =
  | {
      ok: true;
      status: "running";
      progress: TProgress;
    }
  | {
      ok: true;
      status: "completed";
      data: TData;
      warnings?: ToolIssue[];
    }
  | {
      ok: false;
      status: "partial";
      data: TData;
      error: ToolIssue;
    }
  | {
      ok: false;
      status: "blocked" | "failed";
      error: ToolIssue;
    };
```

语义固定如下：

| status | ok | 含义 | LLM 可用信息 |
|---|---:|---|---|
| `running` | true | AsyncGenerator preliminary output，操作仍在进行 | `progress` |
| `completed` | true | 工具完成并产生可信结果 | `data`、可选 `warnings` |
| `partial` | false | 已产生可用部分结果，同时存在失败 | `data`、`error` |
| `blocked` | false | 前置条件不满足，工具没有执行核心操作 | `error` |
| `failed` | false | 核心操作已尝试但没有可用结果 | `error` |

状态基数的设计取舍（对齐基准、避免过度发明）：MCP/Anthropic 只有 `is_error` 一个布尔，我们的多态是有意的最小扩展，每一态都必须对**模型下一步行为或 UI 呈现**产生真实差异，否则应合并：

- `partial` 保留：图片/视频部分成功（保留成功产物 + 逐项失败）是真实产品需求，`is_error` 布尔无法表达。
- `blocked` 与 `failed` 分列而非合并：二者对模型的指引不同——`blocked` 是“没跑核心操作，先补前置条件（配置/权限/输入/文档状态）”，`failed` 是“跑了但没结果，可能可重试”；且现有工具（`read_file` 的 `FILE_NOT_ATTACHED`、`memory` 的 `MEMORY_NOT_FOUND`、`web_search` 缺配置）已在用 blocked 语义，合并会丢失这层可执行区分。`code`+`retryable` 承载细节，`status` 承载粗粒度分流，二者不冗余。

v1 固定保留 `blocked` 与 `failed`，不把该协议决策留到实施阶段。前端可以共享视觉组件，但模型语义必须保留“核心操作尚未执行”与“核心操作已经执行但失败”的区别。

外层 `ok` 只表达工具 outcome，不承载领域判断。例如 HTML 校验请求成功返回校验结论时，外层是 `{ ok:true, status:"completed" }`，校验是否通过由 `data.valid` 表达；不能再用外层 `ok:false` 同时表示“校验不通过”和“校验工具调用失败”。

`ok` 与 `status` 存在固定映射（`running`/`completed`→`true`，`partial`/`blocked`/`failed`→`false`），因此 **`ok` 一律由 Schema factory 从 `status` 派生，工具实现和 helper 永远不手写 `ok`**。这避免双判别字段漂移——当前 `observability/lifecycle.ts` 与 `runs/repository.ts` 对 `ok:false` 的处理已经不一致，正是双真相源的早期症状，统一后按 `status` 单一来源判定。

### 5.2 ToolIssue

```ts
type ToolIssue = {
  code: string;
  message: string;
  retryable: boolean;
  source?: string;
  details?: Record<string, JSONValue>;
};
```

字段约定：

- `code`：稳定、机器可读、UPPER_SNAKE_CASE，例如 `KNOWLEDGE_VALIDATION_FAILED`、`VIDEO_SEGMENTS_FAILED`、`PROVIDER_RATE_LIMITED`。
- `message`：给 LLM 和用户阅读的真实原因摘要，必须自包含，不能只写 `HTTP 422` 或 `workflow failed`。
- `retryable`：表示再次调用工具可能有意义，不代表 Runtime 自动重试，也不保证相同输入可成功。
- `source`：失败来源，例如 `knowledge`、`executor`、Provider 名称、`mcp:<server>`。
- `details`：安全、有限、结构化事实，例如 `status_code`、`task_id`、`request_id`、`failed_items`、`required_limit`、`actual_count`。

批量失败统一放在 `details.failed_items`：

```ts
type FailedItem = {
  index?: number;
  id?: string;
  code?: string;
  message: string;
};
```

禁止在标准错误中加入由工具决定的 `next_action`。工具只报告事实和 `retryable`，下一步由主 Agent 判断。

### 5.3 Progress

Progress 仍使用 AI SDK AsyncIterable 的 preliminary tool result：

```ts
{
  ok: true,
  status: "running",
  progress: {
    task_id: "...",
    phase: "generating",
    done: 3,
    total: 7
  }
}
```

规则：

- `running` 永远不是终态。
- 一个流式工具必须产生且只产生一个终态 `completed`、`partial`、`blocked` 或 `failed`，且**终态必须是最后一次 `yield`**。
- AI SDK 的 `executeTool`（`@ai-sdk/provider-utils/dist/index.d.ts` 中 `executeTool`）会把每个 `yield` 作为 `preliminary` 输出，并在迭代结束后**把最后一次 `yield` 的值再作为 `final` 输出重放**。因此终态只能通过 `yield` 交付；async generator 的 `return value` 会被 `for await` 丢弃，SDK 拿不到，会退化成“无终态”。Wrapper 与所有流式工具**绝不能用 `return` 交付终态**。
- Iterator 正常结束但没有 `yield` 过终态时，Wrapper 生成 `INTERNAL_TOOL_PROTOCOL_ERROR`。
- Iterator 在终态之后继续 yield 时，Wrapper 停止消费并记录 invariant 日志，不向模型追加第二个终态。
- 迭代期间抛出的非控制流异常，Wrapper 捕获后**追加一次 `yield` 的 `failed` 终态**（不是 `return`），成为 SDK 的 final 输出。

## 6. Manifest Wrapper 设计

### 6.1 `manifest.ts` 成为唯一工具构造入口

为保持 Demo 阶段迁移轻量，保留现有 `defineAgentTool(name, tool(...), policy, planning)` 调用面，但改变其语义：Manifest 不再只追加 metadata，而是统一替换公开 `outputSchema`、包裹 `execute`/AsyncIterable，并无条件安装 `toModelOutput`。因此内置工具无需为了协议迁移机械重写全部构造代码，模型可见的最终 Tool 仍只有 Manifest 一个出口；这不是旧输出兼容层，旧私有 shape 不再出现在 Manifest 之后的 UIMessage/LLM 边界。

职责边界：

- `inputSchema` 仍是模型输入契约。
- 传入 AI SDK Tool 的原 `outputSchema` 在 Manifest 内被视为纯领域 data schema，禁止包含协议级 `ok/status`。
- 流式 progress 当前使用严格 outer envelope + `unknown` payload；各卡片继续校验自己的领域 progress。
- Manifest 使用 Schema Factory 合成统一 `ToolOutcome<TData,unknown>` `outputSchema`。
- `execute` 返回领域数据、显式 emission、Promise 或 AsyncIterable；Wrapper 负责变成公开 outcome。
- metadata、policy、planning、availability 继续由 Manifest 维护。

### 6.2 内部 ToolEmission

工具实现使用内部 emission helper 表达需要显式控制的结果：

```ts
type ToolEmission<TData, TProgress> =
  | { status: "running"; progress: TProgress }
  | { status: "completed"; data: TData; warnings?: ToolIssue[] }
  | { status: "partial"; data: TData; error: ToolIssue }
  | { status: "blocked" | "failed"; error: ToolIssue };
```

- 普通同步/Promise 工具可以直接返回 `TData`，Wrapper 自动生成 `completed`。
- 已知失败优先显式返回 `toolFailed()`、`toolBlocked()` 或 `toolPartial()`，以提供稳定 code 和 details。
- 未知 throw 是兜底路径，由 Wrapper 规范化。
- AsyncGenerator 的每一次 yield 都必须使用 `toolRunning/toolCompleted/toolPartial/toolBlocked/toolFailed`。Wrapper 不猜测裸 snapshot 的终态含义；发现裸值立即产生 `INTERNAL_TOOL_PROTOCOL_ERROR`，防止 `data.ok/data.status` 等协议字段被重复嵌套。

### 6.3 同步、Promise 与 AsyncIterable 包装

Wrapper 执行顺序：

1. 调用原始 `execute`。
2. 若返回普通值或 Promise，等待结果并转为单个终态 outcome（普通值/Promise 工具通过 `return` 交付即可——AI SDK 对非 AsyncIterable 的返回值直接作为 final 输出）。
3. 若返回 AsyncIterable，使用包装后的 async generator 逐项消费和映射 emission。
4. 执行调用、Promise rejection、`for await` 迭代和 iterator cleanup 都进入同一异常边界。
5. 非控制流异常转为 `{ok:false,status:"failed",error}`：AsyncIterable 路径必须作为**最后一次 `yield`** 交给 AI SDK（见 §5.3，`return` 会被丢弃）；普通值/Promise 路径作为 `return` 值交付。
6. Abort/Stop 异常原样抛出，绝不转换为普通 tool result。

### 6.4 Schema 合成

- 内置工具和 Skill 使用 Zod Schema，`toolOutcomeSchema(dataSchema, progressSchema)` 直接生成联合 Schema。
- 当前运行时内置、Skill 和 client Tool 都使用 Zod；`toolOutcomeSchema(dataSchema)` 直接生成联合 Schema。
- FlexibleSchema/MCP 的真实合成推迟到 MCP runtime 接线时完成，不在无调用方时预造 adapter。

### 6.5 `toModelOutput`

- UI 通道与模型通道正交：`execute` 的 ToolOutcome 原值进入官方 tool part 的 `output-available`，供持久化和前端卡片使用；`toModelOutput` 只把同一结果转换成下一轮 LLM 的 `ToolResultOutput`。不新增第三条错误通道。
- Manifest 对每个工具无条件安装 `toModelOutput`。`completed` 委托原转换器处理 `data`，无原转换器时使用 `json`；`partial` 使用 `json` 发送完整 outcome，保证部分数据和错误同时可见；`blocked/failed` 使用 AI SDK 原生 `error-json` 发送 `ToolIssue`。
- client tool（如 `ask_user`）没有服务端 `execute`，Manifest 仍贡献统一 `outputSchema` 和模型转换器。由于当前续跑入口调用 `validateUIMessages()` 时尚未解析 ToolSet，不能假定 AI SDK 会自动执行该 schema 校验；服务端必须在 continuation merge 边界直接用共享 ToolOutcome Schema 校验浏览器提交的 envelope。
- `load_skill` 和 `read_skill_file` 成功时继续生成原有 XML 内容；失败时不能调用成功转换器。
- MCP Tool 若已有 `toModelOutput`，只在成功时用原始 `data` 调用；MCP `isError:true` 映射为标准失败。

## 7. 错误分类和规范化

### 7.1 统一 normalizer

新增 Chat Agent Tool 边界专用 `normalizeToolIssue(error, context)`。它不放入共享 `libs/`，避免把 Agent 领域策略污染内核。

优先级：

1. 已经是 `ToolIssue` 或显式 Tool Failure：校验、裁剪后直接使用。
2. `TransportError`：读取 `service/status/body`，从 body 中按 `detail.message`、`detail`、`message`、`error`、`title` 的优先级提取原因，并保留安全结构化字段。
3. AI/Provider SDK 已知错误：读取状态码、Provider request id、retryable 标记和 cause。
4. Executor `Task` 终态：携带 `task_id`、task type、终态、失败项和 Provider 原因。
5. 普通 Error：使用 name/message，code 为 `TOOL_EXECUTION_FAILED`。
6. 非 Error 值：安全 JSON 序列化；无法序列化时使用有意义的类型摘要，绝不调用裸 `String(object)`。

### 7.2 安全与长度

- `message` 最大 2,000 字符；`details` 整体最大约 8 KB，按字段裁剪，不切断 JSON 结构。
- 删除匹配 `authorization`、`api_key`、`token`、`secret`、`cookie`、`credential` 的字段。
- 不返回 stack、完整 URL query、二进制、HTML 正文、Prompt 全文或内部认证信息。
- 完整 Error、stack、原始 body 进入结构化服务日志，并关联 `run_id/tool_call_id/task_id`。
- Provider request id 和稳定错误码应保留，便于排障。

### 7.3 retryable 规则

| 类型 | retryable | 说明 |
|---|---:|---|
| 429、上游 5xx、连接中断、明确临时不可用 | true | 新调用可能成功 |
| 超时且已确认原任务取消 | true | 可以由 Agent 决定新建调用 |
| 输入可修正、数量超限、格式不支持 | true | 必须先修改输入，不能原样重试 |
| 资源不存在、权限不足、缺少配置 | false | 当前上下文直接重试无效 |
| 内容审核拒绝、Provider 明确不支持 | false | Agent 应解释或改方案 |
| 未知实现错误/invariant | false | 避免模型盲目循环 |

`retryable=true` 仅表示“再次调用可能合理”。系统 Prompt 仍要求模型根据 message/details 判断是否必须修改输入或等待。

## 8. 必须继续抛出的控制流异常

以下情况绝不能转为 `ToolOutcome`：

1. 当前 Run 的 `AbortSignal` 已触发。
2. `AbortError`、用户 Stop、服务端 Run cancellation。
3. AI SDK Tool approval refusal；继续使用原生 `output-denied`。
4. 无效工具名、Tool Call input schema 解析失败、Tool approval 协议错误、缺失 tool result 等 AI SDK 协议错误。
5. Tool 尚未开始前的 Runtime 构造失败，例如重复工具名或无法解析 Tool Schema。

用户 Stop 必须终止 Agent Loop，持久化未完成 tool parts 为现有 `output-error/已取消`，并取消关联 Executor 任务。不能把它变成 `{ok:false}` 后让模型继续说话。

## 9. 工具迁移

### 9.1 Search

- `web_search`：成功返回搜索数据；主 Provider 与 fallback 都失败时，标准错误中同时保留两侧原因。无结果是成功的空结果，不是工具失败。
- `knowledge_search`：完整提取 Knowledge 4xx/5xx body；输入或文档状态问题使用稳定 code。

### 9.2 Files

- `list_files`：成功数据进入 `data`。
- `read_file`：文档仍在 processing 属于可信领域状态，返回 completed data；Knowledge 请求失败才是外层 failed。
- 不再只返回 `knowledge request failed: 422`。

### 9.3 Planning 与 Todo

- `write_plan`、`update_plan`、`update_todos` 的成功输出进入 `data`。
- 计划前置条件或状态冲突使用 blocked。
- `next_suggestion` 若仍存在，只是成功数据中的 advisory，不进入标准 ToolIssue，也不能被 Harness 当成路由指令。
- Context projector、plan continuation、最新 Todo 提取逻辑全部读取 `outcome.data`。

### 9.4 Client Tool：ask_user

- `ask_user` 没有服务端 `execute`，仍由浏览器使用 `addToolOutput` 回答。Manifest 对它是 **schema-only**（见 §6.5）：只提供统一 `outputSchema`，不包裹 execute。
- Browser 提交 `{ok:true,status:"completed",data:{answers...}}`，保证模型看到的所有 tool result 使用同一 envelope；`mergeClientContinuation` 在写入/投影前使用共享 Schema 校验该 envelope。`outputSchema` 仍保留为 Tool 定义的一部分，但不能替代这个显式续跑边界校验。
- 用户没有作答时不伪造 failed；保持 input/approval continuation 状态。

### 9.5 Skill

- `load_skill`、`read_skill_file` 成功 data 继续通过成功专用 `toModelDataOutput` 注入 XML。
- 未知 Skill、重复加载、路径不可读返回 blocked/failed，并进入下一轮 LLM。
- Skill 加载状态不能因失败被误标为已加载。

### 9.6 Artifact

- `write_file`、`edit_file` 的 queued/running 变为统一 progress。
- Executor terminal failure 变为标准 failed，包含 `task_id`、阶段和 Executor 原因。
- 有可用文档但存在非阻塞问题时使用 completed + warnings；确实只有部分产物可用时使用 partial。
- `html_validate` 外层 completed，领域结果改为 `data.valid/errors/advisories/content_sha256`；请求失败才是外层 failed。
- `list_artifact_blocks` 的 JSON 解析失败不再静默返回 `{}`，而是标准 failed。
- Artifact quality gate 读取标准 outcome：只有 execution completed 后才检查 `data.valid`；工具 failed 时退出当前 gate 并把 observation 交给主 Agent，不能无限内部修复。

### 9.7 Images

- 初始输出：`running`，progress 包含 requested count。
- 全部成功：completed，data 包含 images/count。
- 部分成功：partial，data 保留成功 images，error.details.failed_items 包含每个失败 Prompt 的 index/code/message。
- 全部失败：failed，不能只返回第一条模糊异常。
- Abort 继续抛出。

### 9.8 Video

- queued/running 通过 progress 返回 `task_id`、phase、done/total。
- completed data 返回文档引用和媒体信息。
- Executor failed/cancelled（非当前用户 Stop）映射为标准 failed，携带 task_id、失败镜头编号、成功数量、总数和各 Provider 原因。
- 当前已暂存的 Executor 错误增强保留；Chat 中“terminal failure 必须 throw native tool-error”的修改改为标准 outcome。
- 失败进入下一轮模型后，LLM 可以直接解释、精简镜头/角色/时长后重新调用，或结束；Wrapper 不做决定。

### 9.9 Memory

- candidate 创建成功进入 completed data。
- 审批仍是独立的人机流程，不把“等待审批”伪装成失败。
- 权限、资源或持久化问题返回标准 blocked/failed。

### 9.10 MCP 与动态扩展

现状说明：`ToolCatalog` 已支持 `register(extension)` 并把扩展命名空间化为 `mcp__{server}__{tool}`，但**运行时尚未接线**——全仓库没有任何 `toolCatalog.register(...)`/`createMcpExtension(...)` 调用点，`factory.ts` 也不传带 extension 的 catalog。因此本任务只在文档和类型上固定 Extension/MCP 必须采用相同 ToolOutcome 的边界，不实现 Catalog wrapper、不增加 MCP 验收项。等 MCP 真正接线时再连同动态 Tool UI 做一条真实纵向薄片。

- 后续接线时，Catalog 对每个 host-executed extension tool 使用同一个 wrapper。
- 后续接线时，MCP `CallToolResult.isError=true`、结构化错误和 thrown exception 映射为标准 ToolIssue，并保留 server/tool 名称。
- Extension 不允许覆盖标准 `ok/status/error/data/progress` envelope。
- 动态扩展工具必须继续使用官方 `dynamic-tool` part；本任务不为尚未出现的 part 增加前端兼容分支。

## 10. 重试策略

目标不是“系统永不重试”，而是“任何会重新执行用户业务动作的重试都由 Agent 决定，并表现为新的可见 tool call”。

判定标准（唯一）：一次重试是否会**重新执行一个有副作用的用户业务动作**。会 → 删除，交给 Agent 作为新的可见 tool call；不会（幂等 create、只读 poll、durable replay）→ 保留为传输层恢复。

### 10.1 删除的隐藏重试

- Video/Artifact Provider create step 默认 `maxRetries: 0`；当前 Ark create 请求没有向 Provider 传递稳定幂等键，任何 429/5xx/网络异常都不能由 WDK 隐式重新执行 create。查询、轮询等只读 step 可以保留有限重试。
- Provider 已经返回明确失败时，不在 Workflow Step 内重新创建 Provider 任务。只有 Provider 明确支持且调用端实际传递稳定幂等键后，create step 才能恢复基础设施重试。
- 对可识别的 Provider/API 错误，Workflow 返回结构化失败或使用 FatalError 跳过 WDK 默认 Step retry，避免同一次可见 Tool Call 产生第二个生成动作。
- Agent-facing nested generation 调用如支持 `maxRetries`，业务请求设置为 0；失败回到主 Agent，而不是在 Tool 内重复生成。
- 不实现 Wrapper 自动 retry、指数退避策略或 retry 配置旋钮。

### 10.1a Executor 启动失败显式化

当前 WDK `start()` 不支持调用方提供稳定 run id，无法证明“Workflow 已创建但响应丢失”后的再次 start 不会创建第二个 run。因此本轮采用更保守、也更符合用户可见重试原则的实现：删除 `startTaskResilient` 的 POST 自动重试，改为单次 `startExecutorTask`。Executor 在 Workflow start 抛错时立即把已插入的 queued task 标记为 failed 并保留真实原因；进程崩溃留下的 `workflowRunId=null` task 仍由启动 reconcile 明确标记 failed。后续是否再次调用工具由 LLM 决定，并产生新的 owner_ref/toolCallId。

启动请求最终失败时不假定 Chat 已知 `task_id`：响应已收到则携带 `task_id`，响应在创建后丢失则至少携带稳定的 `owner_ref/toolCallId`，供 Agent、用户和日志关联；绝不创建第二个 owner key。

### 10.2 保留的恢复行为

- `GET /tasks/:id` 状态轮询保留；它是等待异步任务的协议，不会重新执行生成动作。
- Poll 的短暂只读传输恢复可以保留现有有限次数，但最终失败必须携带已知 `task_id`，且绝不创建第二个任务。
- Workflow crash/replay、队列重新投递和已完成 Step 的 durable replay 保留；它们属于基础设施恢复，必须依赖现有幂等键避免重复副作用。
- HTML deterministic validate/repair gate 保留，但工具执行错误必须交回主 Agent；只对明确校验 findings 做新的可见 edit/validate tool calls。
- 主模型调用自身的 Provider transport retry 不属于 Tool Outcome，本任务不修改。

### 10.3 Agent Prompt

Runtime contract 增加统一规则：

1. 每次工具调用后检查 `ok` 和 `status`。
2. `partial` 时先利用已有 data，再决定是否补偿失败项。
3. `blocked/failed` 时读取 `code/message/retryable/details`。
4. 可以直接向用户解释并结束，也可以换工具、修改输入或发起新的工具调用。
5. 任何重试都是新的可见 tool call；不能把 `retryable:true` 理解为原样自动重试。
6. 对内容审核、权限、缺少配置和明显输入上限，不得原样重试。

## 11. UI 与 UIMessage

### 11.1 Wire 语义

- 业务失败仍是官方 `tool-*` part，AI SDK state 为 `output-available`，output 是 `ToolOutcome`。
- 用户 Stop、协议异常和未规范化 Runtime 异常才使用 `output-error`。
- 审批拒绝继续使用 `output-denied`。
- 不增加 `data-tool-error` 或第二条 SSE。

### 11.2 前端解析

Chat MFE 增加唯一 `parseToolOutcome(unknown)` helper：

- 验证 `ok/status` 判别关系（`ok` 与 `status` 不一致的 envelope 视为损坏）。
- 分别暴露 `data/progress/error/warnings`。
- 非法 envelope 作为“工具返回协议损坏”展示，不猜测旧结构。
- 同时覆盖官方 `tool-<name>` 与 `dynamic-tool`（MCP/动态扩展）两类 part 的 `output`；两者的 outcome 解析走同一 helper。

所有卡片迁移：

- Generic Tool：`blocked/failed/partial` 使用错误样式，partial 同时展示可用结果。
- Image：从 progress 读取生成数量，从 data 读取图片，从 error 读取逐项失败。
- Video：从 progress 读取任务进度，从 data 读取 document id，从 error 读取镜头失败原因。
- Artifact：从 progress/data 读取任务和文档；failed 展示 Executor 原因。
- Todo/Plan/Skill/Ask User：从 completed data 读取领域输出。

Tool part 即使是 `output-available`，只要 outcome `ok:false`，UI 使用 `output-error` 的视觉语义，但不能篡改 AI SDK part state。

## 12. 持久化与观测

### 12.1 Tool Call 记录

不做数据库迁移，复用 `agent_tool_calls`：

- AI SDK execution 正常产生 ToolOutcome 后，始终把完整 envelope 写入 `output_json`。
- Outcome 为 completed 时记录 `status=completed`。
- Outcome 为 partial/blocked/failed 时记录 `status=failed`，同时把 `error.message` 写入 error 摘要；不能为了写 error 而丢弃 output_json。
- 原生 tool-error/output-error 仍记录 failed 和 error。
- 删除 `html_validate` 特例以及“任意 object 有 `ok:false`”的宽松语义猜测，只识别标准 envelope。

### 12.2 Lifecycle 与 Trace

- `onToolExecutionEnd` 同时记录：
  - `agent.tool_execution_success`：AI SDK 是否成功执行并获得 result。
  - `agent.tool_outcome_status`：completed/partial/blocked/failed。
  - `agent.tool_retryable`：若存在。
- 标准失败不会让整个 Agent Run 失败；只有 Agent Loop/模型/协议/取消失败才影响 Run status。
- Trace API/UI 本任务只保证 completed/failed 状态与 Chat Tool 卡片一致，不承诺展示完整 ToolOutcome。详细错误留在持久化 `output_json`、服务日志与聊天工具卡片；若未来要在 Trace UI 展示 details，必须显式扩展 OpenAPI 字段并运行 `just sync`。
- 现状纠偏：`errorText()`（`repository.ts`）已优先 `JSON.stringify`，字面 `[object Object]` 已很少；真正的问题是 **`TransportError.body` 等 provider/业务事实在抛出后丢失**，以及把整个 output 对象塞进 error 摘要。本方案的收益是让 normalizer 保留 provider/body 事实，并把**可读 error 摘要（`error.message`）与完整 `output_json`（整个 envelope）分离持久化**，不再用序列化整个对象充当 error。`errorText()` 保留安全 JSON 兜底，杜绝残余 `[object Object]`。

## 13. 实施顺序

### Phase 1：协议基础

1. 在 Chat tool types 中定义 ToolOutcome、ToolIssue、ToolEmission 和 helper。
2. 实现 outcome Schema factory、异常 normalizer、Abort 判定和 execute/AsyncIterable wrapper。
3. 重构 Manifest 为唯一 Tool 构造入口。
4. 在类型和文档中固定 Extension 接线约束；不改造当前未接线的 Catalog runtime。

完成标准：可以用一个同步工具、一个 Promise 工具和一个 AsyncGenerator 工具证明成功、迭代异常、Abort 三条路径类型正确。

### Phase 1.5：端到端纵向薄片（先跑通再铺开）

在批量迁移前，先挑两个覆盖面最广的真实工具打通全链路，验证 envelope 在真实 UI/持久化/trace 上成立：

1. `generate_video`：覆盖流式 progress、终态失败、Executor 终态、Abort。
2. `knowledge_search`：覆盖 `TransportError.body` 提取与结构化 ToolIssue。
3. 若必须在薄片阶段冻结 partial 契约，再加入 `generate_images`；否则 partial 随 Phase 2 图片迁移验收，不伪造视频/搜索的 partial 场景。

一路打通 wrapper → normalizer → 持久化（`output_json` + error 摘要分离）→ 前端 `parseToolOutcome` → 卡片 → trace，手工验收通过后再进入 Phase 2。这是 Codex/Cursor “先薄片跑通再铺开” 的做法，能在改动 8+ 工具前暴露 envelope 设计漏洞，避免协议未验证就大规模返工。

完成标准：这两个工具的 success/progress/failure/Abort 路径在真实 UI 与持久化上正确；`generate_images` 迁移后再验收 partial。

### Phase 2：全部工具直接迁移

1. 先迁移无流式工具：Search、Files、Planning、Memory、Skill。
2. 迁移客户端 `ask_user` 输出。
3. 迁移 Artifact 及 quality gate consumer。
4. 迁移 Images、Video 和 Executor task progress。
5. 更新 Context projector、continuation、artifact verification 等所有读取工具输出的内部消费者。

完成标准：仓库中不存在模型可见工具自定义顶层 `{ok,status,...}` Schema，也不存在绕过 Manifest 的 host execute。

### Phase 3：错误和重试收敛

1. 将 TransportError、Provider Error、Executor terminal error 映射为稳定 ToolIssue。
2. 删除会重复执行副作用的隐藏重试，修复 Executor orphan task 失败归档；只保留 read-only polling 和 durable replay（见 §10.1a）。
3. 保留并完善当前视频失败片段/Provider 原因增强。
4. 更新 Agent Prompt，使重试决策完全回到 LLM。

完成标准：一次业务失败只执行一次业务动作，后续尝试必然产生新的 tool call id 和用户可见卡片。

### Phase 4：UI、观测和文档

1. 增加前端统一 outcome parser 并迁移所有 Tool Card。
2. 修正 lifecycle、repository、run finalization 与 trace 语义。
3. 重写当前暂存 ADR 0042 为“Agent Tool Outcome”，同步 ADR 0035、Chat AGENTS 和 UIMessage stream 文档。
4. 删除旧分支、特例和过时注释，不保留兼容 shim。

## 14. 验收场景

### 14.1 成功与领域结果

- `list_files` 成功：LLM 收到 completed + data。
- `html_validate` 请求成功但页面不合格：外层 completed，`data.valid=false`，quality gate 使用 findings；不显示工具崩溃。
- Search 无结果：completed + 空结果，Agent 可以换 query。

### 14.2 结构化业务失败

- Knowledge 返回 HTTP 422：LLM 收到具体业务 code/message/body facts，不是 `knowledge request failed: 422`。
- 缺少 Provider：blocked、retryable=false，Agent 告知用户配置，而不是重复调用。
- Skill 名称无效：blocked，LLM 可以从 available skills 选择正确名称。
- MCP 不在本任务验收范围；未来运行时接线时，`isError:true` 必须映射为标准 failed，并补真实端到端验收。

### 14.3 部分成功

- 五张图片中三张成功：partial data 保留三张图片，failed_items 包含另外两张的独立原因；UI 可打开成功图片，LLM 决定是否只补失败项。
- 不允许只返回 `failed:2` 而没有原因。

### 14.4 视频

- 七镜头全部成功：running progress 最终变 completed。
- 十二镜头全部失败：failed details 包含 `completed=0`、`total=12`、失败镜头列表和 Provider 原因。
- 角色超过三个：返回输入上限事实；Agent 可移除角色后发起新的可见调用。
- Provider 审核拒绝：retryable=false，Agent 不原样重试。
- Poll 网络最终失败：任务已启动时返回已知 task_id；启动响应丢失时返回 owner_ref，绝不自动创建第二个 owner key。

### 14.5 控制流

- 用户在视频运行中点击 Stop：Abort 向上传播，Executor 任务取消，Run 终止，不触发下一轮 LLM。
- Tool approval 被拒绝：保持 output-denied。
- 非法 Tool input：由 AI SDK Schema/repair 路径处理，不伪造 ToolOutcome。

### 14.6 持久化与 UI

- 所有标准失败均持久化完整 output_json 和可读 error。
- 数据库、Trace、日志和工具卡片中不存在 `[object Object]`。
- 刷新/恢复会话后，业务失败仍显示结构化错误卡片。
- 旧输出不做兼容解析；非法/旧 envelope 显示协议错误或依赖 Demo 数据重置。

## 15. 验证命令

遵循 Demo 阶段规则，不新增测试文件，不运行 `just test`：

```bash
cd apps/backend
just lint chat
just build chat
just lint executor
just build executor

cd apps/frontend
pnpm -F chat typecheck
pnpm -F chat build
```

本方案不修改 HTTP/OpenAPI 路由和 DTO，因此默认不运行 `just sync`。若实施过程中为了 Trace 增加公开字段，必须先更新 Chat OpenAPI，再运行根目录 `just sync` 并验证前后端构建。

手工验收至少覆盖：一个同步成功、一个 TransportError、一个部分图片失败、一个视频 terminal failure、一个 Skill failure、一个用户 Stop。MCP 留到真实接线时验收。

## 16. 文档与现有改动处理

当前工作区已有的视频错误增强不丢弃，但需要按本方案重新归位：

- Executor 统计成功片段、失败片段和首个 Provider 原因的改动保留并扩展为结构化 details。
- Chat `generate_video` terminal failure 的 throw 改为标准 failed outcome。
- Repository 的安全 JSON error 序列化保留，并用于统一 normalizer/持久化。
- Runtime Prompt 中“新可见 tool call 才是重试”的原则保留，措辞改为统一 outcome。
- 暂存的视频错误 ADR 直接重写并重命名为 `docs/ADR/0042-agent-tool-outcomes.md`，不新增 superseding ADR，不保留已经被本计划否定的 native-error 决策。
- ADR 0035 和 `schemas/streaming/chat-uimessage-stream.md` 更新为：进度与业务失败都使用官方 tool output；只有控制流/协议异常使用 output-error。

## 17. 最终完成定义

仅在以下条件全部满足后声明完成：

1. 所有当前运行时模型可见的内置、Skill 和客户端工具都使用统一 ToolOutcome；MCP/Extension 接线约束已记录，但未接线实现不计入完成范围。
2. Wrapper 覆盖同步、Promise、AsyncIterable 迭代异常和 cleanup。
3. Abort、Stop、approval、协议错误边界没有被转换成普通值。
4. 业务失败稳定进入下一轮 ToolLoopAgent LLM，Run 本身仍可正常结束。
5. 没有 side-effecting 业务动作隐藏重试；新的尝试均是新的可见 tool call。
6. UI、Context projector、quality gate、持久化、Trace 全部消费新协议。
7. 没有旧 shape 兼容层、工具名特例或 `[object Object]`。
8. Chat/Executor lint 与 build、Chat MFE typecheck 与 build 全部通过。
9. ADR 0042、ADR 0035、Chat Runtime 文档和 UIMessage stream 契约与实现一致。

## 18. 实施结果

- `manifest.ts` 已成为当前模型可见工具的统一 ToolOutcome 边界，覆盖同步、Promise、AsyncIterable、迭代异常和 Abort 传播；后实现审计修正了 async wrapper 会吞掉 AsyncIterable preliminary output 的运行时问题。
- 后续 SDK 原生能力审计补齐了无条件 `toModelOutput`：UI 继续保存完整 envelope，模型侧 completed/partial 使用 `json`，blocked/failed 使用原生 `error-json`。旧 `{status,conflict}` 嗅探已删除，相关工具改为显式 emission 或结构化 blocked exception。
- `TransportError.body`、普通 Error、非 Error 值和显式 blocked 前置条件已进入统一 ToolIssue；Skill 未加载/不存在使用 blocked。
- `ask_user` 浏览器答案使用 completed envelope，服务端 continuation merge 显式校验。
- 图片部分成功使用 partial，保留成功文档与逐项失败原因；视频 terminal failure 使用 failed outcome，LLM 可见 Executor 原因。
- Media/Artifact 流式工具已全部改用 `toolRunning/toolCompleted`，data/progress 只含领域载荷，不再嵌套 `ok/status`；图片 partial 同样使用纯 payload。
- Media `retryable` 依据错误性质生成：超时和非确定性 Provider/Executor 失败允许 Agent 评估新的调用，取消、审核、权限、缺配置和明确不支持固定为 false；防御性未知终态使用稳定 `VIDEO_TASK_UNEXPECTED` code。
- `agent_tool_calls` 对业务失败同时保留完整 `output_json` 和可读 error 摘要；lifecycle/span 记录 outcome status 与 retryable。
- Ark side-effecting create step 设置 `maxRetries = 0`；Chat 删除 Executor POST 隐式重试；Executor Workflow 启动失败立即归档为 failed，避免同进程孤儿 queued task。
- Chat MFE 使用唯一 strict outcome parser，Artifact/Image/Video/Todo/Ask User 卡片和 cancellation/context/quality-gate consumer 已迁移。
- MCP runtime 仍未接线，按本计划不实现、不验收；未来接线时必须补真实动态 Tool 纵向薄片。
- 已通过：`just sync`、根 `just build`、Chat/Executor scoped lint 与 build、Chat MFE typecheck/build、变更文件 Biome check。
- 根 `just lint` 的首个阻塞位于未改动的 `apps/backend/services/knowledge/src/infrastructure/persistence/models/artifact.py` import 顺序；单独运行 frontend 全量 lint 还会报告 MarkdownEditor、FileWorkspace 等无关既有诊断。本任务未越权修改；本次变更的 8 个前端文件定向 Biome check 已通过。
