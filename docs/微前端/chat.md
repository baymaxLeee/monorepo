# chat MFE

对话域 micro-frontend，挂载于 `/platform/chat/*`，后端为 chat service。

## 核心约定

- 消息流使用 AI SDK v7 `useChat` + `DefaultChatTransport`，直接消费原生UIMessage SSE parts。
- 交互只有 Send/Stop：持久化消息加载并确认 `active_run_id` 后才调用 `resumeStream()`；空闲会话不做探针。`GET /conversations/{id}/stream` 先完整 replay 当前 active message 的语义投影，再接同一 Run 的 live tail；`204 active-detached` 只以 2 秒起步、最长 30 秒退避重试轻量 GET，不轮询完整会话，`204 idle` 才一次性回退 PostgreSQL completed-step journal。重复 POST 遇到 `409 active_run_detached` 时转入同一 GET resume 流程。
- Stop 同时调用 `useChat.stop()` 与 run cancel API；前者断开本地 subscriber，后者才终止服务端 Agent。浏览器断连本身不再等价于 Stop。
- cancel API 返回后重新读取持久化消息；未完成的 HTML/image/video/tool 卡片使用 `output-error`，todo 使用 `cancelled`，不得从历史消息继续渲染 loading。
- 会话路由按 conversation id 隔离 `useChat` 实例；切出会话时只 abort 旧实例的 subscriber，防止多个 running 会话占满浏览器连接池，切回后从 journal 补读已提交 step 并继续跟踪 active run。
- `ask_user` 等 client tool 通过 `addToolOutput` 回填；所有 client tool 完成后由 `lastAssistantMessageIsCompleteWithToolCalls` 自动发起下一次 run。一个 `ask_user` 卡片可展示多个带稳定 ID 的问题，全部回答后只提交一次结构化 tool output。
- client-tool continuation 的 401 先由 `authFetch` 刷新 token 并重放；最终仍失败时保留本地 tool output。transport 在进入 AI SDK error 状态前透明地额外重放一次；全部失败表示 refresh session 已失效，由全局 session 事件触发路由重新认证，不显示无效的业务重试按钮。失败回调不得从持久化历史覆盖尚未写入服务端的回答。
- active POST 与恢复 GET 返回 `x-agent-run-id`，用于 Stop 和执行轨迹查询；无本地 hub 时同时用 `x-agent-run-state: active-detached|idle` 消除 204 歧义。stream 内容仍完全遵循 AI SDK UIMessage 协议。
- Cloud Plan 由 `tool-upload_artifacts` 批量结果投影成 `data-file`，携带稳定的运行时文件引用；后续 run 从服务端会话历史和 conversation-file registry 恢复。后端把该不可变 Plan 导入 `/workspace/sources/saved/<file_id>/`，runtime contract 要求先用 Bash 完整读取。Desktop Plan 直接保存在用户选择的本地 workspace，不经过上传或 `data-file`。执行结束后按钮变为“再次执行”而不是永久禁用，后续点击仍携带稳定 id，不依赖长对话里的旧计划内容。
- Cloud `upload_artifacts` 的官方批量 tool output 携带 `files[]`；tool part 按通用工具 UI 保持可观测，不使用专用预览卡；流层另逐文件生成 `data-file` 正文 file tag，且不复制成原生 `file` part。原生 model `file`/`reasoning-file` 仍按文件 part 呈现，两类产物保持不同协议语义。Desktop 不注册该工具。
- HTML artifact 使用独立右侧普通 iframe，按浏览器原生语义开放脚本、模块、表单、存储、导航、Canvas/WebGL、Worker、媒体和交互能力，不维护 sandbox allow-list。完整正文经 Chat 的鉴权 file delivery facade 按需加载，不进入聊天消息。Markdown/Plan file id 在同一面板只读渲染。
- 视频生成调用 Runtime 的 `generate_video`。工具等待生成并发布会话文件，前端通过对话中的文件引用呈现结果。

普通 CRUD 使用 `@repo/api`；禁止跨 MFE import，跨域通信使用 `@repo/runtime` 事件总线。
