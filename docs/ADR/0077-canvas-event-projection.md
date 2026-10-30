# ADR 0077: Canvas 的快照与增量事实投影

## 状态

Accepted.

## 背景与依据

Canvas 从 multix-app 迁入后，正式图、任务轮询、单节点文本 SSE、审核轮询和命令响应回填各自更新页面，无法可靠呈现其他窗口或后台任务的写入。

采用原仓库 ADR-043 的事务日志、连续 cursor、UTF-8 文本 checkpoint 和 keyed patch 思路，并参考 llmops-web Studio 的顶层投影与组件草稿分工。原仓库独有的 generation batch 不迁入；本仓库的元信息、私有故事板、审核与导出记录纳入同一个投影。传输参考 [WHATWG SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html)，持久化参考 [GORM transaction](https://gorm.io/docs/transactions.html)。

## 决策与取舍

保留 `getCanvasGraph` HTTP 全量快照承担初始化和恢复，SSE 只发送增量，避免大画布快照超过 SSE 帧大小限制。数据库事务内记录有序事件，使任意服务副本和后台生产者都能提供同一提交顺序；相较进程内广播，多承担日志存储与读取开销，换取可重放和跨副本一致性。

每个画布由一个顶层投影持有正式事实，命令完成需要观察到对应 cursor。组件只保存交互状态和未提交草稿，删除轮询、旧文本流、Redis 文本缓冲及响应回填，避免多写入者争夺状态。连接恢复不能决定生成任务的存活，文本生产者独立持久化 checkpoint。Chat 仍使用 AI SDK UIMessage，不承载 Canvas 复制协议。

这提供服务器排序的状态同步，不提供 CRDT 或协同文本编辑；本地未提交编辑不会广播。媒体签名 URL 在交付时由冻结的资产身份补充，不进入持久日志。事件表通过 `v1.0.1` 增量迁移创建，保留已有数据；升级策略由 [数据与部署决策](operations.md) 维护。

当前协议、生命周期及验证入口由 [Canvas events](../../schemas/streaming/canvas-events.md) 维护；部署约束见 [Canvas 服务](../微服务/canvas.md)。
