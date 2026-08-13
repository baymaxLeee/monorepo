# Responses-first 上下文与平台依赖统一升级

## 目标

- 删除文本模型的 Chat Completions 传输，统一使用 Responses-native driver。
- 本地 `UIMessage` 语义账本保持业务权威；支持供应商 continuation 时使用 response chain，不支持时回放 Responses items。
- 统一升级 Vercel AI SDK、Hono、Nitro 与 Workflow DevKit 到实施时 npm `latest`。
- 保持单 Agent `ToolLoopAgent`、UIMessage SSE、持久化 Workflow 与顶层 `just` CLI 契约。

## 实施

1. 将 AI SDK Core/React/provider/OpenAI、Hono 及其 Node/Zod 适配器、Workflow/Nitro 版本统一到 workspace catalog，更新 lockfile 并删除 Chat-only provider。
2. Admin provider 增加显式 Responses driver/capability 契约；所有文本模型调用通过共享 Responses transport，禁止按 URL 猜协议或静默回退。
3. 将 response id、parent response id、provider/model、finish/usage 写入 message/run/step metadata；reasoning、tool call/result 和 provider metadata 以官方 UIMessage parts 完整持久化。
4. Context Projector 支持 continuation 与 replay；换 provider/model、chain 无效或不支持 continuation 时从本地账本重建 Responses input。
5. 升级 Chat、Executor、Admin/Knowledge 的调用方，并复核 Nitro/Workflow 的 nf3、OIDC trace、World 启动和 production build workaround。
6. 更新 ADR/领域文档，运行 `just install`, `just up`, `just sync`, `just build`, `just lint`, `just dev` 与真实 provider conformance checks。

## 验收重点

- 文本模型网络请求不再出现 `/chat/completions`。
- 多轮、工具循环、审批 continuation、reasoning、取消、chain 失效回放均保持语义完整且不重复执行工具。
- 前后端使用同一 AI SDK 协议版本；Hono/Nitro/Workflow 构建和运行契约不回退。
- demo 阶段不新增测试脚手架。
