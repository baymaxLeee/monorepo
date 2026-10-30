# 当前架构决策

这里是按主题压缩后的当前决策集。每篇文档原地维护，不再累积编号 ADR 或追加
“更新覆盖上文”。旧版本通过 Git 追溯，工作树只保留当前决定及必要理由。

| 主题 | 决策 |
|---|---|
| 服务组成、分层、共享与事务边界 | [architecture](architecture.md) |
| 主 Agent、上下文、工具与流 | [agent-runtime](agent-runtime.md) |
| Workflow、耐久任务、取消与审批 | [durable-execution](durable-execution.md) |
| Asset、Knowledge、Canvas 与文件生命周期 | [files-and-assets](files-and-assets.md) |
| IAM、scope、caller identity 与 Admin 配置 | [identity-and-configuration](identity-and-configuration.md) |
| MFE、路由、包、AI UI 与设计边界 | [frontend](frontend.md) |
| 数据基线、部署、密钥与观测 | [operations](operations.md) |
| AI 开发入口、增量验证与文档维护 | [engineering](engineering.md) |

业务细节从 [docs/index.md](../index.md) 进入；字段、版本、端口以 schema/manifest
为准。决策文档不再复制完整清单、代码教程和任务执行日志。

这是本仓库的快照约定，区别于传统不可变 ADR。追溯使用
`git log -- docs/ADR` 和 `git show <commit>:docs/ADR/<old-file>`。
修改当前决策时同时更新代码、所属业务规范和验证入口；新提案尚未实现时明确标记，
不能以“已接受”掩盖实现缺口。

本轮重写期间另一项任务新增的
[Canvas 事件投影](0077-canvas-event-projection.md)原样保留，由该任务维护。
它是并行工作边界，不恢复时间序列文档作为默认阅读路径。
