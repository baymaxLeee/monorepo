# 开发规范

| 主题 | 文档 |
|---|---|
| 命名与边界 | 各 `AGENTS.md` |
| 异常处理 | 后端使用 `kernel.errors`,禁止裸 `HTTPException` |
| 审计 | 由服务按其领域与存储边界实现；共享能力须先满足 ADR-0061 consumer matrix |
| 权限 | gateway 负责公共鉴权边界，服务执行自身授权；不得预设不存在的共享 SDK |
| 提交 | Conventional Commits with scope (`feat(bot):`、`fix(mfe-admin):`) |
| 模块大小 | 详见各 AGENTS.md |
