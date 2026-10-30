# 开发规范

| 主题 | 当前事实源 |
|---|---|
| 命名、分层与边界 | [后端 AGENTS](../../apps/backend/AGENTS.md)、[前端 AGENTS](../../apps/frontend/AGENTS.md) 及最近的 AGENTS |
| Python HTTP 异常 | `kernel.errors`；其他语言使用各服务错误边界 |
| 审计 | 资源所属服务负责，不存在统一 audit 服务 |
| 权限 | Gateway 认证；服务检查 tenant/workspace 与资源权限 |
| UI | [DESIGN.md](../../DESIGN.md) |
| 数据库升级、回退与数据迁移 | [数据库迁移规范](database-migrations.md) |
| 测试与增量验证 | [测试政策](testing.md) |
| 架构/业务文档 | [文档规则](../AGENTS.md)，当前规范原地更新 |
| 提交 | Conventional Commits with scope，例如 `feat(chat): ...` |

共享实现需要真实多消费者或已记录的必须集中的安全/协议约束；不预建对称 SDK。
