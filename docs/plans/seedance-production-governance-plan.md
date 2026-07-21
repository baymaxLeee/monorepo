# Seedance 2.0 制片治理层实施计划

## 目标

在现有 `ToolLoopAgent + Workflow DevKit` 视频链路上增加制片治理层。Chat 负责意图与工具调用；Executor 持有耐久 Workflow、制片状态、审批、成本和 QA；Knowledge/ObjectStore 持有暂存及正式媒体；Chat MFE 提供会话内右侧导演工作台。

核心约束：

- 一镜头、一剧情节拍、一次 Seedance、一个连续动作。
- 付费生成不自动重试；局部重做必须由用户显式触发。
- Workflow Hook 承担跨会话审批，AI SDK tool approval 不承担长流程审批。
- UI 只投影 Executor 的耐久状态，不建立第二套前端状态源。
- “发布”仅表示批准正式写入 Knowledge，不包含外部渠道投放。

## 类型与状态

制片过程固定产出 `CreativeBrief`、`Script`、`ShotPlan`、`AssetManifest`、`RenderReport`、`QAReport`。每个产物包含 schema/version、输入哈希、payload 和 provider/model/参数/来源/actor 等 provenance。

`ShotSpec` 包含 narrative beat、subject anchors、action、camera、environment、lighting palette、audio direction、references、continuity contract 和 acceptance criteria。纯函数式 `SeedancePromptCompiler` 只接收已批准的 ShotSpec 和参考资产，按稳定顺序编译 Ark 请求并生成请求哈希。

生产状态机：

`intake -> planning -> awaiting_storyboard_approval -> generating -> shot_review/assembling -> final_qa -> awaiting_publish_approval -> publishing -> completed`

任意非终态均可进入 `failed` 或 `cancelled`。

## 分期

### 1. 治理基础与分镜审批

- 建立 production、不可变产物、事件和决策持久化。
- Reference Intake 探测素材及授权元数据。
- Workflow 在分镜完成后使用确定性 Hook 等待审批。
- `generate_video` 返回 `awaiting_approval`，不占住 Agent SSE 等待整条 Workflow。
- 工作台支持结构化编辑 ShotSpec；保存产生新版本，旧审批失效。

### 2. 成本预留与受控生成

- Admin provider 增加 currency、generated-second unit 和 unit-price-micros 定价。
- Storyboard 审批提交单次 production 预算上限。
- 每个 Ark create 前 reserve，创建后 reconcile，未创建则 release。
- 默认每镜头一个 Take；额外 Take 必须由用户主动触发且不得突破预算。

### 3. 分层 QA 与 Take 决策

- 确定性检查覆盖解码、时长、画面、重复帧、黑帧和音频。
- 语义 QA 对照 ShotSpec 输出评分、时间点、证据帧和 finding。
- 损坏文件、缺镜头和授权问题不可豁免；语义 QA 缺失或审美 finding 可由授权用户带理由豁免。

### 4. 暂存、最终 QA 与正式入库

- Knowledge 支持 conversation-scoped 暂存媒体。
- 最终 QA 通过并批准发布后，暂存媒体原子转换为正式文档。
- 拒绝、失败或取消时清理暂存对象，同时保留审计元数据。

### 5. 会话内导演工作台

- 将右侧 Artifact panel 直接重构为 `artifact | video-production` workspace。
- 展示阶段、镜头、Take、成本、QA、审批原因和事件日志。
- 所有审批仅接受显式 UI 操作；工作台通过 Chat 的 conversation-scoped API 投影 Executor 状态。

## 验收

Demo 阶段不新增测试脚手架。每阶段运行受影响服务 lint/build；API 变化后运行 `just sync`。最终验证审批版本冲突、action 幂等、Workflow 重启恢复、付费任务不重试、预算并发、QA 豁免、取消清理、暂存可见性和页面刷新恢复，并按 ADR-0016 完成实现后复盘。

## 实施校准与状态

本实现继续使用一个 Chat `ToolLoopAgent`，耐久暂停交给 Workflow Hook；没有引入第二个 agent loop 或角色扮演式 sub-agent。依据为仓库安装版本的 `ai/src/agent/tool-loop-agent.ts`、`workflow/docs/foundations/hooks.mdx` 和 `workflow/docs/foundations/versioning.mdx`。这也与 Codex、Claude Code、Cursor 的单主循环、显式工具副作用和外部耐久状态投影形状一致。

已完成：耐久 production/artifact/event/decision、确定性 Hook、provider 定价与并发预算预留、黑帧/冻结帧等确定性 QA、暂存/预览/批准入库、失败取消清理、conversation-scoped 工作台与显式审批。工作台现在支持结构化编辑 ShotSpec；保存会通过 Hook 进入 Workflow step，持久化新的不可变 shot-plan artifact、递增服务端版本并使旧审批失效。每个初始镜头生成后进入 `shot_review`，用户可预览 Take、显式付费重拍单个镜头、为每个镜头选择一个成功 Take 后再合成；额外 Take 复用同一预算 reserve/reconcile 账本。审批 action id 冲突、pending 决策租约/自动恢复、Hook 重放去重、语义 QA 豁免理由和货币字段溢出风险已在实现后审查中直接修正。

仍未完成，不能把当前实现称为完整计划交付：证据帧、时间点和评分驱动的模型语义 QA。当前实现是确定性 QA 加带理由的人工豁免；接入模型语义 QA 还需要单独确定视觉模型、证据帧采样与评分契约，不能用无证据的模型结论冒充已完成。

## 参考

- [Workflow Hooks](https://useworkflow.dev/docs/foundations/hooks)
- [AI SDK ToolLoopAgent](https://ai-sdk.dev/docs/agents/overview)
- [Seedance 2.0](https://seed.bytedance.com/en/blog/seedance-2-0-official-launch)
- [OpenMontage](https://github.com/calesthio/OpenMontage)
