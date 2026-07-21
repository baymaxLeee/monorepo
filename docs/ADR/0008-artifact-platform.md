# ADR 0008: Chat 内核中的 Durable Artifact Tool

- 状态：Superseded by ADR-0010 and ADR-0011
- 日期：2026-06-28

## 背景

Artifact 是 Agent 的核心能力，目标是用大型交互式 HTML 覆盖约 10–100 页的
PPT、报告和传统办公文档。`chat` 是统一 Agent Server，能力通过 AI SDK tools
扩展；用户要求主 agent 必须等待 create/update 完成后才结束当前 turn。

现有实现仍以单次完整 HTML 生成、全文 `content_md` 和字符切片更新为核心，无法
提供 block 级并发、独立重试、可靠 resume 与局部 revision。

## 决策

1. 不新增 Artifact Server、数据库或对象存储。`chat` 继续拥有 Agent orchestration
   和 Artifact tools；`knowledge` 继续拥有 Artifact 持久化与现有 ObjectStore。
2. `create_artifact` / `update_artifact` 的 tool execute 在 chat 内启动幂等 child
   artifact workflow，并 `await childRun.returnValue`。因此主 agent 等待完整
   Artifact 成功落库后才继续下一模型 step。
3. child workflow 依次执行 plan、并行 block generation、compile、persist/publish。
   多个 block 使用有界异步 I/O 并发；每个生成单元是 durable step，可独立重试。
4. LLM/API 调用是 I/O 工作，不使用 worker thread。只有未来 HTML compiler、PDF
   render 等经过观测证明是 CPU 瓶颈时，才引入 worker thread/process pool。
5. Artifact 的权威源逐步迁移为 manifest + 稳定 block IDs；完整 HTML 是由 chat
   compiler 生成、经 knowledge ObjectStore 持久化的 revision 产物。
6. update 生成 block change set，只重写受影响 blocks；删除字符切片全文更新。
7. Tool 的主结果仍保持小型，只返回 document/revision 元数据；生成进度通过现有
   Workflow stream 的 `data-artifact` 事件发送，但主 tool 状态直到完成才变为
   `output-available`。

## 父子 Workflow 语义

- 当时的主 agent runtime 会 await 所有带 execute 的服务端 tools。
- tool step 首先按 `toolCallId`/generation id 查询 knowledge 中的 generation record。
- 已有 `workflow_run_id` 时通过 `getRun()` 重新连接；没有时才 `start()` child
  workflow 并立即持久化 run id，避免 tool step retry 重复启动。
- tool step 等待 `childRun.returnValue`；child 失败则返回明确 tool error，主 agent
  可解释或重试，不产生半成功文档。
- cancel 主 Agent 时同时取消 child run；已落库 block draft 可供 resume 复用。

## 服务职责

### chat

- Artifact tool schemas、planner、block generators、compiler。
- child Workflow orchestration、并发控制、progress events、错误分类。
- 从 admin 获取 provider snapshot；从 knowledge 读取 source documents。

### knowledge

- Artifact metadata、generations、blocks、immutable revisions、assets。
- 复用当前 ObjectStore 保存 block content、assets 和 compiled HTML。
- CAS publish、slice/range/preview response、ETag。
- 不执行 LLM 调用，不理解 Agent 对话。

## Runtime 与安全

- chart 输出声明式 ECharts option，runtime 由 chat compiler 固定版本装配。
- 默认 block 不允许任意 JS；受限 custom HTML 作为后续逃生口。
- compiler 负责 CSP、print CSS、错误边界、block anchors 与 runtime version。
- preview 使用稳定 revision URL，前端不再把超大 HTML复制进 `iframe.srcDoc`。

## 后果

- 保留一个核心 Agent Server 和一个存储服务，无新部署单元。
- 主 turn 会等待大 Artifact 完成，延迟较长但语义符合产品要求；进度 UI、cancel 和
  resume 因此是必备能力。
- child workflow 增加一次 orchestration 层，但换来 block 级 durable retry 和明确
  的父子取消关系。
- 这是 demo 阶段的不兼容演进，不为字符切片旧路径保留长期 adapter。
