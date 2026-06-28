# chat service

TypeScript / Hono / Vercel AI SDK v7 Agent Runtime。业务状态存于 MySQL；
文档和 artifact 由 knowledge 持久化。运行时由 `@hono/node-server` 托管；用 `tsx`
直接运行 TypeScript 源码（`@backend/transport-ts` 是源码包，tsc 产物会留下无法
解析的裸 import），`tsc --noEmit` 仅做类型检查。

## API

- `POST /conversations/{id}/agents/run/stream`：启动一次 ToolLoopAgent UI stream
- `GET /conversations/{id}/agents/runs/{runId}/trace`：读取步骤与 tool trace
- 会话 CRUD 与文档 facade 路由保持不变

## Agent runtime

- 主链使用 `ToolLoopAgent`。HTTP 请求的 AbortSignal 贯穿模型、web search、图片
  分析和 artifact 内部模型调用；前端 Stop 后服务端不会继续生成。
- 不提供 pause/resume/replay API。跨 run 的继续依靠持久化消息、plan snapshot 和
  artifact 状态，而不是恢复进程栈。
- `ask_user` 没有服务端 execute；客户端 `addToolOutput` 后发起下一次 run。
- assistant UIMessage 在 stream end（包括 abort 的部分输出）持久化；run trace 写入
  失败不能影响用户流。
- `update_plan` 以 tool output 保存完整 snapshot，下一 run 注入最新 active plan。

## Artifact

- Markdown：`create_artifact`。
- 大型 HTML：主 Agent 调用 `begin_artifact`、多次 `write_artifact_part`、最后
  `publish_artifact`。knowledge/ObjectStore 保存 block 和 compiled revision。
- 完整 HTML 不进入 SSE、MySQL message 或 trace；历史 tool input 只保存长度占位。
- 主 Agent 会等待 tool 完成再继续，因此无需为 artifact 单独创建 server 或 workflow。

跨服务调用必须经过 `@backend/transport-ts`；provider 配置归 admin，artifact 归
knowledge。架构决策见 ADR-0011。
