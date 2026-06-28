# Durable Artifact Tool 落地计划

执行基线见 [ADR 0008](../ADR/0008-artifact-platform.md)。`chat` 是唯一 Agent
Server；`knowledge` 和现有 ObjectStore 负责存储，不新增服务。

## 成功标准

- 主 WorkflowAgent 等待 Artifact create/update 完成后才结束 turn。
- 10–100 页内容按稳定 blocks 有界并发生成，单块失败可独立 durable retry。
- 浏览器断线或服务重启后可恢复同一父/子 workflow 与进度流。
- Workflow state、tool result、SSE 均不携带完整超大 HTML。
- 更新一个章节不全文读取、切片、生成或覆盖。
- compiled HTML 通过稳定 revision URL 预览，前端不使用大型 `srcDoc`。

## 运行拓扑

```text
WorkflowAgent (chat parent workflow)
  └─ create_artifact tool step
       ├─ find-or-start child artifact workflow
       └─ await childRun.returnValue
            ├─ planArtifact step
            ├─ Promise.allSettled(generateBlock steps, bounded concurrency)
            ├─ compileArtifact step
            └─ persistRevision step → knowledge/ObjectStore
```

并发指异步 LLM I/O 并发，不是 worker thread。Compiler 先在事件循环内运行；只有
CPU profile 证明阻塞时才迁移到 worker/process。

## 文档模型

Manifest 保存结构、主题、block briefs 和稳定 ID。首批 block：`cover`、
`rich_text`、`section`、`chart`、`table`、`metric_grid`、`image`、`page_break`。
Chart 是 ECharts option JSON，不生成 Canvas JavaScript。

Knowledge 增加：

- artifact generations：toolCallId、child workflowRunId、phase、计数、错误。
- artifact blocks：稳定 block ID、类型、位置、对象 key/hash/size、状态。
- artifact revisions：parent revision、manifest、compiled object key/hash/size。
- artifact assets：复用 ObjectStore 的图片、字体和附件元数据。

## Create

1. tool step 以 toolCallId 向 knowledge 幂等 reserve generation。
2. 已有关联 child run 则 `getRun()`；否则 `start()` 并绑定 run id。
3. child planner 生成有大小上限的 manifest，不生成完整 HTML。
4. blocks 按配置的并发窗口生成并立即写 knowledge ObjectStore。
5. block schema 校验失败时执行一次定向 repair；仍失败则 child workflow 失败。
6. compiler 从已落库 blocks 装配完整 HTML、CSP、print CSS 和固定 runtime。
7. knowledge 事务创建 immutable revision 并 CAS 更新当前 revision。
8. child 返回 document/revision 元数据，tool execute 返回成功；主 Agent 继续总结。

## Update

1. 读取 current manifest、block summaries 和用户 selection。
2. planner 输出 `add | update | delete | move | theme` change set。
3. 只读取和生成受影响 blocks；未变化 block 复用其对象引用。
4. 基于 `base_revision_id` 编译并 CAS 发布新 revision。
5. 冲突时重新规划或明确失败，绝不静默覆盖。

## Progress UX

`data-artifact` 事件改为结构化阶段与计数：

```json
{
  "document_id": "...",
  "generation_id": "...",
  "phase": "generating_blocks",
  "completed_blocks": 18,
  "total_blocks": 42,
  "active_blocks": ["market", "risks"],
  "failed_blocks": []
}
```

前端在 tool card 内显示规划、并发生成、编译、持久化阶段；可展开 block 列表并取消。
Artifact 完成后打开现有右侧 Workspace；后续再根据独立产品需求决定是否拆 MFE。

## 执行阶段

### Phase 1 — Storage contract

- [x] knowledge 增加 generation/block/revision schema 与内部 API（asset schema 待补）。
- [x] 复用 ObjectStore 保存 block 与 compiled HTML。
- [x] transport-ts 增加小型 DTO；大正文仅在 compiler step 内部传输。

### Phase 2 — Child durable create

- [x] chat 新增 artifact child workflow、幂等 find-or-start/await。
- [x] planner + 每批四个并发 block durable steps。
- [ ] block validation/repair 与 deterministic compiler。
- [x] deterministic HTML compiler 初版。
- [x] create tool 切换到新流程并保持主 Agent 等待。

### Phase 3 — Frontend workspace

- [ ] tool card 展示阶段、计数、失败 block、cancel/resume。
- [x] HTML 从 ObjectStore source Blob 加载，不再依赖 `content_md`/`srcDoc`。
- [ ] 稳定 revision preview URL、outline 与生成中骨架。
- [ ] SSE cursor 恢复，正文不进入 UIMessage。

### Phase 4 — Block update

- [ ] change-set planner、局部 block generate、CAS revision publish。
- [ ] selection-scoped edit、历史版本与恢复。
- [ ] 删除字符切片、全文 rewrite、tail preview 和大型 `srcDoc`。

### Phase 5 — Office modes

- [ ] document/presentation/dashboard layout 与 print CSS。
- [ ] 基于同一 revision HTML 的 PDF export。
- [ ] 模板、主题、assets 和发布分享。

## 验证门槛

保持 `just install/up/dev/build/sync/lint` 可用；demo 阶段不增加测试脚手架。每阶段通过
类型检查、build、OpenAPI diff、DB bootstrap、workflow resume/cancel 和浏览器完整流程
验证。
