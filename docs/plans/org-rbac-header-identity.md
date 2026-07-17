# Org 归属 + RBAC + 身份 header 化 落地方案

> 状态：**已实现 / 被 [ADR-0027](../ADR/0027-platform-org-scoped-rbac.md) 取代**。
> Phase 1/2（role 进 JWT → gateway `X-Auth-Roles`/`X-Auth-Org-Role` header、下游按
> role 授权、删硬编码 email 判定、admin 写门控、`/internal` header 身份化、admin
> `v1.8.0` org 化迁移）已落地；Phase 3（skills/mcps 配置存储）仍未做。最终身份/RBAC
> 形态（平台 super_admin ⟂ 组织 org_admin/member + pending/active/rejected 状态机、
> 显式 active-org session、组织与成员管理、审计）以 ADR-0027 为准。

## 背景与问题

当前分支已引入 organization（团队）多租户并把 knowledge 与 bots 做成 org 共享，但
遗留一个设计坑：**超级管理员可聚合并返回所有用户数据**。系统性问题有三：

1. **认证/授权错位**：`is_admin` 在 admin/knowledge/chat/telemetry 四处各自硬编码
   `user_id=="demo-super-admin" || email=="admin@example.com"`，与 iam 真实 role 脱节；
   且 `bots/scenes/intentions/providers` 的**写操作对所有登录用户开放**（仅 `apps` 限 admin）。
2. **数据聚合后门**：`is_admin` 在 CRUD 层跳过归属过滤，聚合返回所有用户数据
   （bots 跨 org、providers 连解密 api_key、conversations、telemetry 全量）。
3. **身份传播不统一且已出错**：公共接口走 `X-Auth-*` header，但 `/internal/*` 与
   transport 客户端把 `user_id/org_id` 当 query/body 传，已出现传错（chat 把 `userId`
   塞进期望 `orgId` 的位置；knowledge 传 `user_id` 给期望 `org_id` 的路由）。

## 业内最佳实践对齐（plan skill 强制）

- **Zero-trust 网关身份传播**：认证只在网关做一次 → 网关剥离入站身份头防伪造 →
  注入可信头（`X-User-Id` + `X-User-Roles`）→ 下游只信 header、不再验 JWT，据此做授权。
  核心：**认证在边缘、授权在下游、角色随 JWT claims 注入 header**。
- **Claude Code 分层配置**：`Managed(组织下发,成员不可改) > User(个人) > Project(团队共享) > Local`。
  其中 **Managed ≈ org 共享 + 仅 admin 配置**（CC 中 enterprise MCP 存在时成员自配一律不加载，
  正是本方案「admin 配置、成员只用」的治理语义）；skills/subagents/MCP 均为「团队级 + 用户级」两级。
- 结论：直接照搬成熟形态，不自创；本 MVP 只做 org（团队）级共享，user 级个人配置留后续。

## 目标架构

### 归属与权限模型

| 类别 | 资源 | owner | 可见性 | 写权限 |
|---|---|---|---|---|
| 团队**配置** | bots/agents、models(providers)、scenes、intentions、(未来)skills、mcps | `user_id`(溯源) | `org_id` 成员只读/使用 | **仅 admin** |
| 团队**知识** | documents / chunks | `user_id`(上传者) | `org_id` 成员共享 | org 成员(可贡献 runbook) |
| **个人**数据 | conversations / runs / messages / memories | `user_id` | 仅本人 | 本人（admin 亦不得读） |
| 平台注册 | apps(MFE 注册表) | 全局 | 按 `requires_admin` | 仅 admin |

### RBAC

- admin 判定统一来自 iam role（`super_admin` / `admin`），经 JWT → gateway header 下传。
- 删除四处硬编码 `email` 判定。
- 配置类资源写操作（create/update/delete/bulk-delete/set-default 等）加 `require_admin` 门控。

### 身份传播链路（统一 header）

```
iam    : JWT Claims 增补 roles → 签发写入
gateway: propagateClaims 注入 X-Auth-Roles（并继续剥离入站伪造头）
下游    : AuthContext.roles 从 header 读；is_admin = 交集(roles, {super_admin, admin})
内部    : transport 客户端注入 X-Auth-User-ID/Org-ID/Roles（+ X-Internal-Token）
         /internal 路由从 header 读 AuthContext，签名删除 user_id/org_id 参数
```

### 接口去参数化铁律

任何业务/内部接口签名都不得含 `user_id / org_id / workspace_id / role`，一律从
`AuthContext`（header 来源）取。（workspace 后端尚不存在，属未来桌面端概念，同原则适用。）

## 已确认决策

1. **providers(models)**：org 共享 + 仅 admin 配置（团队共用一套模型凭证；bot 解析 provider
   改按 org 查）。**更新 ADR-0026** 中「provider org 化留后续」的决策。
2. **scenes / intentions**：org 共享 + 仅 admin 写，与其他配置资源一致。
3. **telemetry**：保留全量看板（运维刚需），判定从硬编码 email 改为 iam role。
4. **skills / mcps 配置存储**：本次不做。二者目前仅是 chat 运行时适配器（无表、无归属）。
   落「org 共享 + admin 配置」需新建表 + CRUD + schema 设计，作为独立的 Phase 3 推进。

## 实施清单

### Phase 1 — 堵漏 + 权限收敛 + role 下传

**iam（Go）**
- `internal/infrastructure/security/token.go`：`Claims` 增 `Roles []string`（`json:"roles,omitempty"`）。
- `internal/application/auth.go`：签发时写入 roles（复用 `userResponse` 已查的 roles）。
- `internal/infrastructure/persistence/repositories/store.go`：如需，补 `UserRoleNames(userID)`。

**gateway（Go）**
- `internal/infrastructure/security/token.go`：`Claims` 与 iam 对齐增 `Roles`。
- `internal/api/http/middleware/auth.go`：新增 `HeaderAuthRoles = "X-Auth-Roles"`；入站先 `Del`；
  `propagateClaims` 注入（逗号分隔）。

**admin（Python）**
- `deps.py`：`AuthContext` 增 `roles: tuple[str,...]`；`is_admin` 改 role 判定；删
  `ADMIN_USER_ID/ADMIN_EMAIL`；`auth_context` 读 `X-Auth-Roles`；新增 `RequireAdmin` dep。
- `crud/{bots,providers,scenes,intentions}.py`：删 `is_admin` 分支与冗余 `user_id` 参数，
  `list/get/bulk_delete` 一律按 `org_id`；`create` 落 `org_id`。
- `services/*.py`：相应调整；`services/bots.py::_resolve_provider` 简化为按 org 查 provider
  （provider 已 org 共享，删除 `owner_is_admin` 借道）。
- `routers/{bots,providers,scenes,intentions}.py`：写操作加 `RequireAdmin`。

**chat（TypeScript）**
- `middleware/auth.ts`：`AuthContext` 增 `roles`；`isAdmin` 改 role；删硬编码；读 `X-Auth-Roles`。
- `services/conversations.ts`：删 `isAdmin` 旁路（list 与 getConversationRow），一律 `userId`。
- `agent/runs/run.ts`：`assertRunAccess` 删 `isAdmin` 旁路。

**knowledge（Python）**
- `deps.py`：删死代码 `is_admin/ADMIN_USER_ID/ADMIN_EMAIL`；如判定需要则读 role。

**telemetry（Python）**
- `deps.py`：`is_admin` 改 role，删硬编码；读 `X-Auth-Roles`。全量看板保留。

**migration（admin）**
- 新建 `migrations/versions/v1.8.0.sql`：`scenes/intentions/model_providers` 加 `org_id`
  列 + 索引 + 回填 `guest-org`（model 已声明 `org_id nullable=False`，DB 需补列对齐）。

### Phase 2 — 内部接口 header 化

- transport-ts `src/{admin,knowledge}.ts`：改为注入 `X-Auth-User-ID/Org-ID/Roles` header，
  接口签名删除 `user_id/org_id`。
- admin `routers/{agents_internal,providers_internal}.py`：删 query `user_id/org_id`，
  改从 header 读 `AuthContext`（`/internal` 仍校验 `X-Internal-Token`）。
- knowledge `routers/*_internal.py` + `services/admin_client.py`：同样 header 化，
  顺手修复 `user_id`↔`org_id` 传错 bug。
- chat `clients/{admin,knowledge}.ts`：透传当前请求的 `X-Auth-*` 到下游内部调用。

### Phase 3 — （不在本次范围）skills / mcps 配置存储

新建 `skills` / `mcp_servers` 表（admin owns，`org_id` + 仅 admin 写），chat 运行时按 org
拉取注入。需单独 schema 设计，独立推进。

## 迁移安全（Definition of done）

- `just lint`（各受影响服务）；跨栈改动 `just sync`（admin/knowledge OpenAPI → 前端 client）。
- `just install && just up && just dev` 冒烟：登录后 JWT 带 roles、gateway 注入 `X-Auth-Roles`；
  非 admin 无法写配置资源、无法看他人会话/bots/providers；admin 可管理配置、telemetry 全量看板正常。
- 前端：admin MFE 写操作对非 admin 返回 403（入口已由 `apps.requires_admin` 控制）；chat 会话
  列表仅显示本人会话（超管不再聚合）。
- 收尾写 `docs/ADR/0027-*`，并更新 ADR-0026 的 provider 决策。
