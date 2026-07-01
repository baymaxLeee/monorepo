# executor service

TypeScript / Hono / Nitro v3 / Workflow DevKit。durable task executor —— chat
的 `ToolLoopAgent`（Brain）委派任何"必须在进程崩溃/重启后仍能完成"的工作给它
（Hands + Session），而不是塞进主对话循环。详见 ADR-0015。

## API

- `POST /tasks`：`{ type, owner_service, owner_ref, payload }` → 立即返回
  `{ id, status: "queued" | "running", ... }`。按 `(owner_service, owner_ref)`
  幂等。
- `GET /tasks/{id}`：任务快照（status/result/error）。轮询是目前唯一的进度
  通道；没有 `GET /tasks/{id}/stream`——评审时发现它是提前建的、从未被任何
  调用方用过的占位端点，已删除，等真正需要 sub-poll-interval 进度时再补一个
  有明确 chunk 格式的版本。
- `POST /tasks/{id}/cancel`：请求取消底层 workflow run。实测 `run.cancel()`
  即使命中正在执行的 step，也在数秒内 resolve——不是"等当前 block 跑完"。因此
  没有、也不应该在 `"use step"` 函数里加自制的取消轮询。

## TaskType registry

`src/tasks/registry.ts` 把一个 `type` 字符串映射到 Zod input schema 和一个
`"use workflow"` 函数。这是未来接入 harness（Codex/Claude Code/Pi 风格外部
session）的替换点——只需要新增一种执行引擎实现，Task API 契约和调用方
（chat）都不用变。

已注册类型：

- `echo`：烟雾测试用，验证 Task API 全链路。
- `html-artifact`：从 chat 的 `agent/artifacts/{worker,generation-runner}.ts`
  迁移而来的大型 HTML 生成流水线（plan → 并发 block 生成 → compile →
  publish）。

## 持久化边界

- 业务真相（谁起的任务、什么类型、完没完成）在 executor 自己的 MySQL `tasks`
  表——和 chat 的 `agent_runs` 是同一种"业务表 vs 执行态"划分。
- 执行/重放真相（run、step、重试、event log）在 Workflow World：本地开发默认
  文件系统 Local World；每个部署环境用自建 Postgres World
  (`@workflow/world-postgres`，独立的 `workflow-postgres` docker 服务，和
  MySQL 分开)。
- `reconcilePendingTasks()` 在进程启动时重新挂载所有 `running` 状态任务的完成
  监听——对 Workflow 的 durable run 重新 `await` 是安全的，不会重新执行任何
  已完成的 step。

## 已知运维事项

Nitro v3（当前 beta）撞到两个与本仓库代码无关的上游 tracer bug，均已修复，
详见 `apps/backend/services/executor/AGENTS.md`：

1. `nf3`/`@vercel/nft` ESM 互操作 bug → `pnpm patch`
   （`apps/backend/patches/nf3@0.3.18.patch`）。
2. `nf3` 复制 `@vercel/oidc` 时路径深度计算错误 → `postbuild` 脚本
   （`scripts/fix-oidc-trace.mjs`，`pnpm run build` 自动跑）。

升级 `nitro`/`workflow`/`ai` 时请重新验证这两个修复是否还需要。

跨服务调用必须经过 `@backend/transport-ts`；executor 不拥有 conversation、
message、document 等领域概念，只知道 task、type 和 payload。
