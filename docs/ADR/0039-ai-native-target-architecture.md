# ADR-0039: AI-Native 目标架构（Single-VPS 主轨 + K8s 双轨）

## Status

Accepted

## Context

Monorepo 进入 demo 阶段后的系统性重构，需要在不拆散七个 deployable 的前提下，收敛
Agent 运行时、租户/S2S 边界、durable execution 与工程链。前序改动已落地 S2S caller
身份、`/internal` 边缘拦截、org_id 贯穿 provider/skill/artifact、executor task
`owner_ref`、tool approval HMAC、UIMessage 全量续流等止血项。

## Decision

### 部署

- **Single-VPS** 为当前主生产轨；**K8s** 为并行维护的第二轨。
- 镜像、端口、env、密钥契约两轨共享；变更必须同步 `infra/single-vps/**` 与 `infra/k8s/**`。
- 废弃 ADR-0035 的 executor→chat 反向推送（`CHAT_SERVICE_URL`）；task 进度走 chat 侧 poll。

### 服务边界（七个 deployable，保留）

| 服务 | 职责 |
|---|---|
| gateway | 边缘路由、身份传播、阻断 `/internal/*` 与客户端 S2S 头 |
| iam | 身份、组织、RBAC |
| admin | 配置平面（providers/agents/skills/catalog/platform bounded contexts） |
| chat | 交互式 ToolLoopAgent、UIMessage 流、run lease |
| executor | 耐久 task + Workflow DevKit 固定 workflow functions |
| knowledge | 文档/RAG/artifact 存储 |
| telemetry | RUM 与运维查询 |

### Agent runtime（双轨，非多 persona）

- **chat**：AI SDK v7 `ToolLoopAgent` 承载普通交互、审批、client-tool continuation。
- **executor**：HTML artifact、video 与其他跨进程长任务统一使用按 task type
  注册的固定 Workflow functions；不在 executor 内启动第二个 agent loop。
- 禁止在 chat/executor 宿主进程执行模型生成的 shell；HarnessAgent 须独立 sandbox（deferred）。

### 生命周期

- Thread = conversation；Turn = 一次用户意图；Invocation = 一次 agent stream；Task = executor durable unit。
- Turn 冻结 profile、provider snapshot、tool manifest；客户端 continuation 只能合并指定 `toolCallId`。

### 前端

- 保留 `platform` + `chat/admin` 内部 Module Federation；remote 必须 same-origin allowlist。
- 迁移 Next.js 须另立 ADR，不在本决策范围内。

## Consequences

- `/readyz` 必须反映 DB/Redis/Workflow World 与 boot reconcile 状态。
- conversation 表冻结 `org_id`；空 org 在 gateway/chat 边界失败。
- admin 单服务内垂直模块化，不拆 ghost 微服务。
- Wave 2–5 的 run.ts 拆分、context 四层、service catalog 等在本 ADR 之后按 plan 交付。

## Supersedes / relates

- 补充 [ADR-0035](./0035-tool-orchestration-and-unified-progress-stream.md)（移除 executor→chat 推送）
- 补充 [ADR-0031](./0031-single-vps-secret-management.md)（双轨密钥同步）
- 补充 [ADR-0011](./0011-tool-loop-agent-core.md)（ToolLoopAgent 为主 runtime）
