# 多 Agent 协作

## 核心理念

**单一 fullstack agent + 单一 context window** 是开发一个需求的最优形态。

跨栈切换通过 `cd`,而不是切换 agent 身份 —— 因为 sub-agent 拥有独立的 context
window,跨栈派工反而会丢失你刚刚建立的设计上下文。

## Sub-agent 的合法用途

只有三类:

1. **苦力活**(无需上下文): codegen、批量重命名
2. **干净视角评审**: reviewer 不应看到主 agent 的设计动机
3. **只读探索**: 深挖代码并返回浓缩报告,避免污染主 context

详见 `.agents/subagents/` 目录。

## Playbook(给主 agent 的工序卡)

| 场景 | Playbook |
|---|---|
| 跨栈一个需求 | `.agents/playbooks/full-stack-feature.md` |
| 新建微服务 | `.agents/playbooks/new-microservice.md` |
| 新建 MFE | `.agents/playbooks/new-mfe.md` |
| 跨服务重构 | `.agents/playbooks/cross-service-refactor.md` |

## Worktree 的使用边界

**默认不用**。仅当 ≥ 2 个 agent **进程** 同时运行时才需要。in-context
sub-agent dispatch 是顺序执行,不会撕裂 git 状态。

详见 `scripts/worktree.sh` 注释。

## Scope 护栏

`.agents/scopes/default.yaml` 给主 agent 列了三档:
- `forbidden`: 绝对不动
- `caution`: 改之前先问
- `free`: 自由发挥

这不是为了"派工",而是主 agent 自我约束的备忘录。
