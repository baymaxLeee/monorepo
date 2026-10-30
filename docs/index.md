# 当前架构与业务规范

日常开发从这里进入。每个主题维护一份当前说明，决策变化时原地修改对应章节、
删除失效描述；不在末尾追加与正文冲突的新版本。历史差异由 Git 保存。

| 主题 | 当前规范 / 事实源 |
|---|---|
| 系统边界与数据流 | [系统架构](系统架构/overview.md) |
| 当前架构决策 | [按主题的决策集](ADR/README.md) |
| 服务组成、端口、binding、数据库 | [services.yaml](../services.yaml)，根 `just lint` 检查漂移 |
| 后端分层与所有权 | [后端规则](../apps/backend/AGENTS.md)、[微服务](微服务/index.md) |
| 前端边界与运行时 | [前端规则](../apps/frontend/AGENTS.md)、[微前端](微前端/index.md) |
| UI 与交互设计 | [DESIGN.md](../DESIGN.md) |
| API / 事件 / stream | [契约入口](../schemas/AGENTS.md) |
| 业务资源归属 | [领域模型](领域模型/index.md) |
| 数据库升级、回退与数据迁移 | [数据库迁移规范](开发规范/database-migrations.md) |
| 编码与验证 | [开发规范](开发规范/index.md)、[测试政策](开发规范/testing.md) |
| AI 开发流程 | [根规则](../AGENTS.md)、[agent workspace](../.agents/README.md) |
| 部署 | [部署规则](../infra/AGENTS.md)、[Single-VPS](../infra/single-vps/README.md)、[K8s 生产](../infra/k8s/overlays/prod/README.md) |

各服务业务说明从[微服务索引](微服务/index.md)进入，只读任务涉及的服务。
`just context <path-or-target>` 定位代码与规则，不需要遍历文档树。

执行规则归最近的 AGENTS，业务解释归主题文档，字段/依赖/端口归 schema 或
manifest。相邻文档链接引用，不复制一套枚举。实现与规范冲突时先追踪生产者、
消费者和测试，确认契约后在同一变更中修正；未实现的方案不得写成当前能力。

## 当前与历史

ADR 已合并为按主题维护的当前决策。实现改变时覆盖对应正文，保留必要理由和
取舍，不新建编号后继文档。旧决定通过 Git 历史追溯，不在工作树并存。

`plans/`、`baselines/`、`阶段性进展/` 和文件名带 `-plan` 的文档是计划或
时间点记录，不参与默认架构检索。读取前必须有具体追溯问题。
