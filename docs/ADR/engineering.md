# 当前决策：面向 AI 的仓库工程与文档

状态：当前。仓库采用按主题覆盖的决策快照，历史通过 Git 追溯。

## 单一入口与按需上下文

根 AGENTS 路由任务，各层 AGENTS 只写本范围约束；通用 skill 在 `.agents/skills/`。
Cursor 入口指向根规则，其他客户端按各自支持的分层规则加载，不复制规则。
任务计划是临时工作状态，不能成为新的架构权威。

`just context <path-or-target>` 返回 owner、根到叶规则链、声明依赖、传递消费者
与测试命令；`just repo-map --json` 提供机器可读项目目录。信息从 manifests
发现，不维护第二份手工项目注册表，不读取源码、环境变量或凭据内容。

Node workspace dependency/dev/peer/optional 构成源码依赖图，应用保持叶节点。
`just check-repo` 拒绝未解析本地依赖、循环、依赖 deployable 和失效文档链接。
前端标签边界仍由 Turbo 执行；后端网络拓扑仍由 services.yaml 管理。

## 验证

根 just 是公共 CLI，本地、agent 和 CI 共用。项目发现、上下文与测试影响选择
复用同一实现。共享 Node 包选择自身和传递消费者；manifest 改动、删除 owner、
未解析依赖或未知范围保守扩大验证。不能用图优化掩盖未声明 import 或跨服务影响。

多个前端 project 合并为一次带明确选择的 Vitest 调用，重叠目标去重。
空套件与 runner 政策由[测试规范](../开发规范/testing.md)维护；缺环境/跳过不得
算通过。测试工具变更执行全量入口；仅文档变更不需要应用构建。

## 文档只维护当前一套

本目录压缩合并原时间序列 ADR，按主题更新正文，删除失效说明。每个文件说明
当前决定、非显然原因、取舍、实现入口与验证边界，不追加实施日志、编号修订层
或“新决定覆盖上文”的段落。业务细节在对应领域文档，字段/端口/版本在配置或
schema；引用所属文件，不在决策文档再抄完整清单。

这是本仓库为 AI 上下文明确选择的约定。传统 ADR 通常保留旧决定并标记替代；
这里使用 Git 保存旧版本，工作树只提供当前快照。追溯历史用 `git log -- docs/ADR`
和 `git show <commit>:<path>`，默认开发不加载旧计划、基线或进展记录。
尚未落地的提案与当前实现分开，不能以文档“已接受”替代真实代码验证。

## 参考与适用边界

[OpenAI Agents SDK](https://github.com/openai/openai-agents-python/blob/main/AGENTS.md)
提供条件触发的 skill/检查入口；[Anthropic Agent SDK](https://github.com/anthropics/claude-agent-sdk-python/blob/main/CLAUDE.md)
提供具体代码定位与命令。采用其可执行入口，不照搬厂商发布/权限策略。
[OpenAI 分层规则](https://developers.openai.com/codex/guides/agents-md)、
[Claude 项目上下文](https://code.claude.com/docs/en/memory)与
[Turborepo 结构](https://turborepo.com/docs/crafting-your-repository/structuring-a-repository)
支持分层指导与声明依赖。Codex 源仓库 AGENTS 本次获取返回 404，未把镜像作为
核实依据。

[AWS](https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html)
和 [GDS](https://gds-way.digital.cabinet-office.gov.uk/standards/architecture-decisions.html)
区分决策历史与当前架构；本仓库采用它们的职责区分，但按用户要求把历史移交 Git。

实现：[repository.mjs](../../scripts/repository.mjs)、[repo.mjs](../../scripts/repo.mjs)、
[test-affected.mjs](../../scripts/test-affected.mjs)。验证包括临时真实 workspace/Git
仓库、错误依赖 fixture、路径继承、runner 参数与退出码；结果在交付时报告，
不作为永久“检查已通过”声明写入本文。
