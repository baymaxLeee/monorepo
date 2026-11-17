# admin service

管理 & 配置面板的后端。除了智能体和技能等业务对象外，admin 还是
"第三方集成"的唯一所有者 —— 当前最重要的就是 LLM Provider。

## Owner / 责任范围

- DB 表：`bots`、`model_providers`、`skills`、
  `skill_nodes`、`skill_published_nodes`（外加
  `migration` 单行版本表）
- 公开 HTTP API（gateway 前置鉴权，路径 `/api/admin-server/*`）：
  - `/bot` —— 智能体 CRUD
  - `/providers` —— LLM Provider 管理（CRUD、`set-default`、`test`）
  - `/skills` —— Skill 工作区、文件懒加载、验证与发布
- 内部 gRPC API（端口 `9001`，gateway **不**代理）：
  - `ProviderService` —— 读取工作区 provider 快照与模型目录
  - `AgentConfigurationService` —— 读取已发布 Agent、Skill 与 Canvas 设置
  - `BenefitPackageService` —— 查询与推进权益包工作流
  - 调用身份由进程固定的 `x-caller-service` metadata 注入，服务端按 RPC method 做 allowlist

## 域所有权

- **Skill package** —— PostgreSQL 文件树是编辑真相源，发布时原子覆盖唯一
  `skill_published_nodes` 快照；草稿通过 node 级 API + etag 更新，没有版本历史。
  Chat 只读取已发布且启用的快照。服务启动不访问 GitHub 或同步远程 Skill。

- **`model_providers`** —— 所有 LLM 凭据的真相之源
  - `(tenant_id, workspace_id)` 作用域内多 provider 共存，聊天模型单个 default
  - `api_key` 以带版本 envelope 的 AES-256-GCM 密文落库（`api_key_enc`）；公开响应返回 `api_key_masked`
    （前 4 + 后 4 + 中间 `****`），明文仅在受 caller allowlist 保护的 ProviderService RPC 回传给 sibling
    服务消费
  - `extra_body` —— vendor-specific 透传 JSON（例如 DeepSeek V4 的
    `{"thinking": {"type": "enabled"}}`），消费服务在调用时与 per-request
    的 `thinking` / `reasoning_effort` 合并
  - 公开 Admin API 与表单用 `context_window_k` / `max_output_tokens_k`
    配置（`1K = 1024 tokens`，0.25K 步进）；数据库和内部 Proto 契约
    仍使用精确 token 整数，避免运行时单位换算。

## 不负责

- 用户身份（→ iam）
- 业务流量本身（→ chat / 后续 LLM 消费服务）
- 大模型调用编排（→ chat） —— admin 只配置 + 测连通

## 加密 / 密钥管理

| 配置项 | 用途 | 生成方式 |
|---|---|---|
| `ADMIN_SECRET_KEY` | AES-256-GCM 密钥；加密 Admin 存储的 credential | URL-safe base64 编码的 32-byte 随机密钥 |
非开发环境启动时的配置安全校验拒绝开发数据库配置与样本密钥。**轮换 `ADMIN_SECRET_KEY` 会让所有
已存 api_key 不可解密** —— 必须配合"清空 + 重新录入"或自定义 re-encrypt 任务。

## 入口文件

- `cmd/server/main.go` — Go HTTP server
- `cmd/openapi/main.go` — 校验 Go binding 的 canonical SHA，并输出 design-first OpenAPI 3.1 artifact
- `internal/api/http/` — 公开 HTTP handlers
- `internal/api/rpc/` — Provider、Agent、Canvas settings 与 benefit-package RPC adapter
- `internal/application/` — 业务编排与授权
- `internal/infrastructure/crypto/` — versioned AES-256-GCM envelope 与脱敏
- `internal/infrastructure/persistence/` — PostgreSQL repositories
- `internal/api/generated/adminapi/` — OpenAPI 生成的 wire types 与路由

## 关键约束

- API key 永远不出公开 API 表面；前端的"编辑"对话框对 `api_key` 字段空值
  表示"保留旧值"。
- `set-default` 在一个事务里把同 user 的旧默认置为 false。
- RPC adapter 校验 caller allowlist，application 同时校验 `tenant_id` 与 `workspace_id`，不允许跨作用域读取。

## 当前实现边界

Go HTTP handler 只覆盖公开 Admin API；所有跨服务能力由生成的 gRPC server interface 显式实现。
旧 internal HTTP path、token map 和 consumer-specific OpenAPI client 已删除。
