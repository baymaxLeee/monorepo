# 开发规范

| 主题 | 文档 |
|---|---|
| 命名与边界 | 各 `AGENTS.md` |
| 异常处理 | 后端使用 `kernel.errors`,禁止裸 `HTTPException` |
| 审计 | 突变成功后用 `audit_sdk.record(...)` |
| 权限 | `auth_sdk.require_action(...)` 装饰器 |
| 提交 | Conventional Commits with scope (`feat(bot):`、`fix(mfe-scene):`) |
| 模块大小 | 详见各 AGENTS.md |
