# admin service

管理 & 配置面板的后端。除了智能体和技能等业务对象外，admin 还是
"第三方集成"的唯一所有者 —— 当前最重要的就是 LLM Provider。

## Owner / 责任范围

- DB 表：`bots`、`model_providers`、`skills`、
  `skill_nodes`、`skill_published_nodes`（外加
  `migration` 单行版本表）
- 公开 HTTP API（gateway 前置鉴权，路径 `/api/admin-server/*`）：
  - `/bots` —— 智能体 CRUD
  - `/providers` —— LLM Provider 管理（CRUD、`set-default`、`test`）
  - `/skills` —— Skill 工作区、文件懒加载、验证与发布
- 内部 HTTP API（gateway **不**代理；仅集群内 sibling 服务可调）：
  - `GET /internal/providers/default?user_id=<uid>` —— 取用户默认 provider 快照
  - `GET /internal/providers/{id}?user_id=<uid>` —— 取指定 provider 快照
  - `GET /internal/skills/{id}?org_id=<org>` —— 读取已发布 `SKILL.md`
  - 鉴权：`X-Internal-Token: <INTERNAL_API_TOKEN>`（constant-time 校验）

## 域所有权

- **Skill package** —— PostgreSQL 文件树是编辑真相源，发布时原子覆盖唯一
  `skill_published_nodes` 快照；草稿通过 node 级 API + etag 更新，没有版本历史。
  Chat 只读取已发布且启用的快照。服务启动不访问 GitHub 或同步远程 Skill。

- **`model_providers`** —— 所有 LLM 凭据的真相之源
  - `(user_id, name)` 维度，多 provider 共存，单个 default
  - `api_key` Fernet 加密落库（`api_key_enc`）；公开响应返回 `api_key_masked`
    （前 4 + 后 4 + 中间 `****`），明文仅在 `/internal/*` 上回传给 sibling
    服务消费
  - `extra_body` —— vendor-specific 透传 JSON（例如 DeepSeek V4 的
    `{"thinking": {"type": "enabled"}}`），消费服务在调用时与 per-request
    的 `thinking` / `reasoning_effort` 合并
  - 公开 Admin API 与表单用 `context_window_k` / `max_output_tokens_k`
    配置（`1K = 1024 tokens`，0.25K 步进）；数据库和 `/internal/*`
    仍使用精确 token 整数，避免运行时单位换算。

## 不负责

- 用户身份（→ iam）
- 业务流量本身（→ chat / 后续 LLM 消费服务）
- 大模型调用编排（→ chat） —— admin 只配置 + 测连通

## 加密 / 密钥管理

| 配置项 | 用途 | 生成方式 |
|---|---|---|
| `ADMIN_SECRET_KEY` | Fernet 密钥；加密 `model_providers.api_key_enc` | `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `INTERNAL_API_TOKEN` | sibling 服务（chat 等）调 `/internal/*` 的共享密钥 | 任意 ≥32 字节高熵字符串 |

`ENVIRONMENT=production` 时 `_enforce_production_safety` 验证拒绝两者的
dev fallback 值，避免线上误用样本密钥。**轮换 `ADMIN_SECRET_KEY` 会让所有
已存 api_key 不可解密** —— 必须配合"清空 + 重新录入"或自定义 re-encrypt 任务。

## 入口文件

- `src/main.py` — FastAPI app + lifespan
- `src/api/http/routes/providers.py` — 公开 CRUD
- `src/api/http/routes/providers_internal.py` — `/internal/providers/*`
- `src/application/providers.py` — 业务编排（含 OpenAI 兼容连通性测试）
- `src/application/encryption.py` — Fernet wrapper + masking
- `src/api/http/dependencies.py` — `InternalCaller` dependency（X-Internal-Token 校验）
- `src/infrastructure/persistence/repositories/providers.py` / `src/infrastructure/persistence/models/provider.py` / `src/application/contracts/provider.py`

## 关键约束

- API key 永远不出公开 API 表面；前端的"编辑"对话框对 `api_key` 字段空值
  表示"保留旧值"。
- `set-default` 在一个事务里把同 user 的旧默认置为 false。
- `/internal/*` 调用方信任 query 里的 `user_id`，但每条记录的 `user_id`
  仍会校验 —— 不允许跨用户读取。
