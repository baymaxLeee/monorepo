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
- `/video-productions/{id}` 与 `/video-productions/{id}/decisions`：读取耐久制片
  投影并提交带版本的审批。视频 Workflow 在分镜、Take 审核和正式发布前等待
  Workflow Hook；Chat SSE 可正常结束，审批从 UI 直接恢复原 run。分镜修改产生新的
  不可变 artifact 版本并使旧审批失效；Take 审核可对单镜头显式付费重拍，并要求每个
  镜头选择一个成功 Take 后才允许合成。

## TaskType registry

`src/tasks/registry.ts` 把一个 `type` 字符串映射到 Zod input schema 和一个
`"use workflow"` 函数。这是未来接入 harness（Codex/Claude Code/Pi 风格外部
session）的替换点——只需要新增一种执行引擎实现，Task API 契约和调用方
（chat）都不用变。

已注册类型：

- `echo`：烟雾测试用，验证 Task API 全链路。
- `html-artifact`：从 chat 的 `agent/artifacts/{worker,generation-runner}.ts`
  迁移而来的大型 HTML 生成流水线（plan → 并发 block 生成 → compile → publish）。
  workflow 不执行 fragment 或整页质量校验，也不因 findings 静默重跑 LLM。
  后续必定执行的 `html_validate` 合并静态校验与基于 block contract 的模型整页
  review，chat 再按 finding 的 block_id 精准 `edit_file` 并复检。
- `video-generation`：`CreativeBrief → Script → ShotPlan → 预算审批 → 单镜头付费生成
  → Take 审核/局部重拍 → RenderReport → 确定性 QA → 暂存预览 → 发布审批 → Knowledge`。Ark create
  始终不自动重试；每次调用先 reserve，创建后 reconcile，创建失败 release。确定性
  QA 覆盖解码、时长、尺寸、音轨、黑帧和冻结帧；语义 QA 仍需人工复核时，发布审批
  必须填写豁免理由并记录 actor。失败或取消会幂等清理尚未发布的暂存对象。视频
  Provider 必须在 Admin 配置 generated-second 单价和币种，否则无法计算审批预算，
  Workflow 会在任何付费生成前失败。

## 持久化边界

- 业务真相（谁起的任务、什么类型、完没完成）在 executor 自己的 PostgreSQL `tasks`
  表——和 chat 的 `agent_runs` 是同一种"业务表 vs 执行态"划分。
- 执行/重放真相（run、step、重试、event log）在 Workflow World：**本地和每个
  部署环境都用自建 Postgres World**（`@workflow/world-postgres`，独立的
  `postgres` 实例上，和 executor 业务库同实例、不同库）——本地/生产一致是明确的
  产品决策，不默认退化成文件系统 Local World（仍然可以通过注释掉 `.env` 里的
  `WORKFLOW_TARGET_WORLD`/`WORKFLOW_POSTGRES_URL` 手动切回 Local World，比如
  离线开发）。`just up` 会起这个容器并跑一次 schema 初始化
  （`scripts/workflow-postgres-bootstrap.sh`，幂等，可重复跑）。**只设置
  `WORKFLOW_TARGET_WORLD`/`WORKFLOW_POSTGRES_URL` 不够**——graphile-worker
  队列要显式调用 `getWorld().start()` 才会真正开始轮询，`src/index.ts` 里已经
  这样做了（见 AGENTS.md 已知运维事项第 3 条）；这条最初就是因为本地默认用
  Local World、从没在本地真正跑过 Postgres World 才被隐藏了一整个阶段，直到
  改成本地/生产一致后才在开发过程中自然暴露出来——这也是"本地要和部署环境
  一致"这条原则本身最有说服力的例证。
- single-VPS 用两个 one-shot job 阻塞 executor 启动：`db-init` 创建并迁移
  PostgreSQL `executor` 业务库，`workflow-db-init` 运行官方 Postgres World setup
  CLI。两者任何一个失败，executor 都不会接受任务。
- `reconcilePendingTasks()` 在进程启动时重新挂载所有 `running` 状态任务的完成
  监听——对 Workflow 的 durable run 重新 `await` 是安全的，不会重新执行任何
  已完成的 step。

## 已知运维事项

Nitro v3（当前 beta）/ Workflow World 撞到几个坑，均已修复，详见
`apps/backend/services/executor/AGENTS.md`"已知运维事项"完整列表（`nf3`
ESM 互操作 bug 已在 `nf3@0.3.19` 上游修复、不再打本地 patch，改用
`pnpm-workspace.yaml` 的 `overrides` 钉版；`nf3` 路径深度计算错误、Postgres
World 启动缺失 `getWorld().start()`、`nitro dev` 与内置 server 对 `.env`
加载行为不同）。
此外，World 实现由 `WORKFLOW_TARGET_WORLD` 动态加载，静态打包器无法发现；
`nitro.config.ts` 必须通过 `traceDeps` 保留 `@workflow/world-postgres`，入口也
保留静态引用，确保生产 `.output` 包含完整运行时依赖树。生产镜像还需要把
`.output/server/node_modules` 暴露为 `/app/node_modules`，因为 Workflow 的
`createRequire` 从应用根目录解析环境变量指定的 World 包。构建后的 OIDC
补丁也必须重写到 `.output/server/node_modules` 内部的稳定相对路径，不能依赖
构建机工作区的目录深度。

升级 `nitro`/`workflow`/`ai` 时请重新验证这些修复是否还需要。

跨服务调用必须经过 `@backend/transport-ts`；executor 不拥有 conversation、
message、document 等领域概念，只知道 task、type 和 payload。
