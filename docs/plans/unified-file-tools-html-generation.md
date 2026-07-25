# 通用 File Tools 与自适应 HTML 生成

## 目标

完成 Chat、Executor、Knowledge 和 Chat MFE 的破坏性切换：

- 所有 HTML 默认由主 `ToolLoopAgent` 使用 exact `write_file` /
  `edit_file` 一次或多轮完成。
- 通用 `delegate_tasks` 只作为独立文件超出主模型实际输出/上下文预算时的
  可选逃生口，不再承载 HTML Shell 或编译协议。
- 删除模型可见的 `generate_files`、Executor `html-artifact` 任务和可变
  spec 二次读取。
- 保留 change set、原子写入、取消、进度和可观测性，删除确定性 HTML
  compile、专用校验和 runtime repair loop。

## 现状判断

| 设计 | 结论 |
|---|---|
| 通用 path-based FileStore/change set | 保留；解决 staging、跨 run 冲突和安全虚拟根 |
| Pi 风格 exact write/edit | 保留；让主 Agent 拥有精确修改能力 |
| `generate_files(spec_path)` | 删除；格式专属、重复 schema、存在 mutable-spec TOCTOU |
| `html-artifact` Workflow | 替换；其真实价值是并发和 durability，不是 HTML planning |
| 主 Agent 多轮输出大型 HTML | 接受；用首稿一致性与可精确编辑性换取初次生成延迟 |
| 全量迁移 Chat 到 `WorkflowAgent` | 本轮不做；短任务继续使用 `ToolLoopAgent` |
| HTML compiler / artifact shell | 删除；模型拥有完整文档结构 |
| `prepareStep` verification fold | 删除；主 Agent 根据用户反馈和真实运行证据修复 |

## 最终工具面

### File tools

- `list_files({ path? })`
- `read_file({ path, offset?, limit? })`
- `search_files({ pattern, path?, glob? })`
- `write_file({ path, content, expected_sha256? })`
- `edit_file({ path, edits, expected_sha256? })`

`write_file` 始终表示完整精确写入，不根据扩展名或内容启动生成任务。

### Orchestration tool

```ts
delegate_tasks({
  root: string,
  shared_context: string,
  tasks: Array<{
    id: string,
    instruction: string,
    output_path: string,
  }>,
})
```

- Chat 在 tool execute 开始时冻结完整 payload，并补充 provider、owner、
  staging 等宿主字段。
- 所有 `output_path` 必须位于 `root` 内且互不重复。
- 每个 worker 是一次 context-free model generation，不获得角色、规划权或
  完整对话历史。
- Executor 只负责有界 fan-out、取消、checkpoint、progress 和写入。
- tool 结果只返回 task id、paths 和 progress，
  不把所有生成正文回灌主上下文。

## 自适应 HTML 路径

HTML capability and generation scale are orthogonal. Every path below preserves
the complete browser runtime, including scripts and dynamic rendering; routing
chooses only who materializes which files.

### 可在一次模型输出内完成

```text
write_file(index.html) -> immediate preview -> optional exact edit
```

文件立即可预览，不创建 Executor task。

### 需要多轮完成

```text
primary write_file(index.html or application shell)
  -> primary write_file/edit_file in later ToolLoop steps
  -> primary exact repairs when user feedback or runtime evidence matters
```

始终由同一个主 Agent 和完整会话上下文完成，不设置页数阈值。

### 极端独立输出

```text
primary proves independent outputs exceed its practical budget
  -> optional delegate_tasks writes unique complete files
  -> Chat atomically promotes the completed batch
  -> primary composes or edits files with ordinary tools when needed
```

这是模型自主选择的逃生路径，不是 HTML workflow。Chat 不再编译 fragment、
派生入口或执行发布门禁。

## 实施阶段

1. **治理和契约**
   - 更新 ADR-0055、Chat/Executor AGENTS 和本计划。
   - 明确 single-agent-first、context-free workers 和无兼容双轨。
2. **通用 durable fan-out**
   - 新增 Executor `file-task-batch` schema、workflow、registry 和 OpenAPI。
   - 复用现有 WDK task 表、poll、cancel、progress 与 provider resolution。
   - 将现有 HTML 并发配置改成通用 file-task fan-out 配置，不新增第二套旋钮。
3. **Thin harness cutover**
   - `write_file`/`edit_file` 对所有格式立即 promotion。
   - 删除 HTML 专用校验工具和前端校验状态。
   - 删除 `prepareStep` verification fold、exact tool directive 和 delivery repair
     协议。
4. **删除 HTML 私有链路**
   - 删除 HTML compiler、artifact shell contract 和 block-scoped validator。
   - 删除 prompt 中的 HTML 分块/委派 workflow。
   - 将 Executor `file-task-batch` 恢复为完整文件 materialization。
5. **跨栈同步和验证**
   - `just sync` 更新 OpenAPI、transport 和 frontend clients。
   - 验证 direct HTML、30–50 page fan-out、失败不发布、Stop/cancel、
     Executor restart recovery 和单页 edit SHA 稳定性。
   - 运行 affected build/lint、root `just build` / `just lint` 和 ADR-0016 review。

## 验收标准

- [x] 轻量 HTML 不创建 Executor task。
- [x] HTML write/edit 立即产生可预览版本。
- [x] 运行时不含 HTML 专用校验工具或 verification state。
- [x] 主 Agent 默认一次或多轮完成大型 HTML。
- [x] `delegate_tasks` 不含 HTML fragment/compiler 约定。
- [x] Executor 重启后 task 可继续并被重新附着。
- [x] Stop 取消 Workflow 并 discard 未发布 change set。
- [x] 成功的 delegated batch 原子发布全部独立文件。
- [x] 运行时代码无 `generate_files` 和 `html-artifact`。
- [x] Executor 不含 HTML brief/theme/outline planner。
- [x] 不新增自定义 stream part 或测试脚手架。
- [x] `just sync`、affected build/lint、root build/lint 通过。
- [x] ADR-0016 post-implementation review 完成。

## 实现后审查

- 从 `.agents/playbooks/cross-service-refactor.md` 重新核对服务边界：Chat 只通过
  transport 调用 Knowledge/Executor，Executor worker 只写调用方创建的 change set。
- 全仓检索旧工具、task type、compiler、verification state、delivery status 及其调用者；
  运行时代码和 streaming 契约均已清除，旧 ADR 明确标记由 ADR-0055 supersede。
- 最终残留清扫删除 Chat 无调用的 artifact model/timeout 文件、Executor 无调用的
  `artifactGenerationId` progress 支路、HTML 专用诊断和 `agent/artifacts/` 子系统。
- 通用执行提示不再编排 HTML 校验；主 Agent 根据用户反馈或真实运行证据进行精准修复。
- 复核 K8s、single-VPS 与 `.env.example`：只保留通用
  `FILE_TASK_CONCURRENCY`，没有 HTML 专属配置或第二套并发旋钮。
- 复核失败与取消路径：委派批次只有完整结果集才 promotion；失败、取消或调用异常均
  discard change set。直接 write/edit 通过同路径 mutation queue 与 Knowledge
  promotion 保持版本和并发边界。
- `just install`、`just up`、`just sync`、`just lint`、`just build` 全部通过；
  `just dev` 启动完整栈后 gateway、chat、knowledge、executor 与 platform 健康检查通过。

## HTML runtime capability correction

- [x] 删除 delegated HTML 的静态 sanitizer；模型输出保留完整 HTML/CSS/JS。
- [x] 删除无法覆盖真实浏览器行为且会产生错误置信度的静态 HTML validator。
- [x] File Artifact 使用普通 iframe，不以 sandbox allow-list 裁剪浏览器能力。
- [x] 更新生成指令和当前服务文档，明确报告、Dashboard、H5 游戏和互动课件共用
  同一套 direct/delegated file tools。
- [x] 重新运行 affected lint/build、根级 lint 和 `git diff --check`。

## 非目标

- 不迁移 Chat 主循环到 `WorkflowAgent`。
- 不构建 persona/role-play 多 Agent 平台。
- 不并发修改同一文件。
- 不把生成语义隐藏进 `write_file`。
- 不新增页数、超时或并发配置；只泛化已有的 operational setting。
