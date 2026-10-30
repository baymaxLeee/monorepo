# AI 开发协作

一个主 agent 对同一需求端到端负责，通过切换目录保持前后端上下文。
机械工作、只读探索与独立评审可使用边界明确的 helper；不把一个功能拆成
互相独立的前后端产品决策。

- 规则入口：[根 AGENTS](../../AGENTS.md)。
- 定位 owner、规则与消费者：`just context <path-or-target>`。
- 图与项目列表：`just repo-map --json`。
- 实施路线：[agent workspace](../../.agents/README.md)。
- 影响预览：`just test-affected HEAD all --list`。
- 当前架构：[决策索引](../ADR/README.md)。

长任务只维护一份当前计划，替换失效状态；进展日志不变成永久规则。
Worktree 用于真正并发写入的隔离，不是“用了 helper 就必须建”的流程。
Scope 文件只是风险提示，不能覆盖用户已明确授权的任务。
