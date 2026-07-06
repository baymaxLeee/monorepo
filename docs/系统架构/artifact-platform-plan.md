# Large HTML Artifact 落地计划

执行基线见 ADR-0010 与 ADR-0011。`chat` 是唯一 Agent Server，主
`ToolLoopAgent` 通过 tools 创建 artifact；knowledge/ObjectStore 负责 block 与
revision 存储，不新增服务或 Workflow host。

## 已落地

- `update_plan` 保存稳定 plan item 与 revision。
- `begin_artifact` 创建 generation 和 manifest。
- `write_artifact_part` 对语义 HTML fragment 清洗后单独持久化。
- `publish_artifact` 确定性编译、发布 revision，SSE/tool output 不携带全文。
- 主 Agent 等待所有 tool 完成；完成的 fragment 从后续模型 context 与 PostgreSQL
  message/trace 中裁剪或脱敏。
- 前端右侧 panel 按 source URL 预览，外层只保留一个 header。

## 后续演进

- block change set + `base_revision_id` CAS，替换旧 artifact 的字符切片 update。
- generation 失败 block 的显式重试与 revision 历史。
- 逐 block 进度 part；只传状态、计数和 bounded preview。
- 编译期 HTML/CSS/JS 校验、静态资源 allowlist 与更明确的预览错误 UI。
- 大规模 artifact 需要并发时，在同一 server 内使用有界任务池；只有出现明确的
  跨进程 crash-safe 后台执行需求时，才在 artifact job 边界引入 queue/workflow。

## 验收

类型检查、build、OpenAPI diff、DB bootstrap，以及浏览器完整验证：普通对话、
Stop、client tool 回答、大型 HTML create/update、artifact 预览与错误呈现。
