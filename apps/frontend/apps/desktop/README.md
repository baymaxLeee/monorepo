# Electron 桌面宿主

Electron 通过 URL 加载现有 Platform，并与 Web 渲染同一套 Chat 路由和组件。普通 Web 开发仍使用根目录 `just dev`；不会顺带启动 Electron。只启动单个前端时，在 `apps/frontend` 目录使用 `just dev platform` / `just dev chat`。

从仓库根目录运行：

```sh
just app                 # 默认 local：启动 just dev，等待 Platform 就绪后打开 Electron
just app vps             # 使用默认单 VPS Platform，不启动本地 Web 服务
DESKTOP_PLATFORM_URL=https://platform.example.com just app vps
# 当前单 VPS 为 HTTP；仅用于受控开发验证，连接没有传输加密。
DESKTOP_PLATFORM_URL=http://124.222.245.5:8080/ just app vps
DESKTOP_PLATFORM_URL=http://124.222.245.5:8080/ just desktop-package
# 可选：让 App 和未来同机 CLI 使用指定的稳定本地运行时目录
MONOREPO_AGENT_HOME=/absolute/path/to/agent-home just app
```

开发和打包都需要 macOS、Xcode Command Line Tools 与 `just install`。打包产物位于 `release/Monorepo-darwin-<arch>/Monorepo.app`，同时生成可下载的 `release/Monorepo-darwin-<arch>.zip`。正式打包会生产构建 Platform、Chat、Admin、Canvas，把资源写入 ASAR，并从受限 `app://platform` 协议加载；安装包不再依赖 VPS 上的前端静态文件，也不显示网关选择页。`DESKTOP_PLATFORM_URL` 是包内固定的 API authority，必须是 Platform 根地址；当前单 VPS 构建使用 `http://124.222.245.5:8080/`。自定义协议只把 `/api/*` 流式转发给该 authority，MFE 和其余资源只能从安装包读取。

`just app` 本地模式托管根目录 `just dev` 的完整 Web 栈，在 Platform 可访问后启动 Electron；关闭 Electron 或按 Ctrl+C 会停止该次启动的开发栈。`just dev` 仍只启动 Web。`just app vps` 默认连接 `http://124.222.245.5:8080/`，也可通过 `DESKTOP_PLATFORM_URL` 指定其他 Platform 根地址；远程 HTTP 只在显式选择 VPS 模式时允许。应用不提供浏览器通用文件或命令接口。当前包会做完整 ad-hoc 签名和签名校验，但未使用 Developer ID、hardened runtime 或 Apple 公证，因此是可安装的内部正式构建，不是可对外无提示分发的 macOS 公证版本。

登录后，Desktop App 与 Web 共享云端会话、历史、Artifact/视频 inspector 和 `/conversations/*` 路由。桌面端新会话 editor 按 Codex App 的上下文栏布局选择“此计算机”或“云端”，本地模式再选择经过 native 授权的项目。云端继续使用统一 Conversation/Storage 上传；本地 `+` 选择的文件作为受限 AI SDK `file` parts 进入本地 thread，不创建云端 conversation 或 Storage 文档。

Chat 侧栏在“最近”上方按项目分组展示本地会话，“最近”按更新时间合并本地与云端会话。同一本地会话在两处共用路由、操作菜单和删除结果。会话通过 `/local/:id` controller 打开，但复用 `ConversationSessionView`、`ChatStream`、`ChatPrompt` 与 composer controls；不恢复工作区/文件侧栏、第二套会话 UI 或 Desktop inspector。此前旧 schema 的本地 SQLite 会话不迁移、不列出、不暴露兼容入口。

本地 journal 不归属于某个 Electron 应用名。默认 runtime home 是 `~/.monorepo-agent`，新
Thread/Turn/Item 数据库位于 `sessions/<identity-scope>/runtime.sqlite`；可通过绝对路径环境变量
`MONOREPO_AGENT_HOME` 覆盖，供同机 Desktop 与未来 CLI 指向同一 authority。这个 schema 是零兼容
切换：旧 `runtime-v1.sqlite`、`sessions.sqlite` 与旧 Electron `userData/local/<scope>` 不读取、
不导入，也不由应用自动覆盖或删除。日常 Agent 操作不得进入 runtime home 或 Electron `userData`；
用户明确要求重置本地 Desktop 数据时，可以在解析并校验精确目录后清理这两个目录。

在“此计算机 → 插件 → 导入本地插件…”选择带 `plugin.json`（Agent Plugins v1）或 `.codex-plugin/plugin.json` 的目录。导入会创建当前账号和工作区的本机副本。新会话可同时勾选该插件和 Admin 已开放的本机可用插件。个人插件默认未勾选，支持 Skill 正文、`references/` 文本资源和 HTTP MCP。平台系统插件及含平台 Skill 的 release 仍在云端运行。

Desktop bridge v8 传递所选插件 ID、来源和非秘密 bindings。utility process 经 main、Chat BFF 和 Runtime 解析平台选择，再合并本机选择。模型调用前持久化去密的 Turn 快照，MCP 工具执行使用内存中的授权，请求结束后释放连接。用户消息经过 main 与 utility process 双重校验，接收文本和有大小限制的内联图片。普通附件通过 `referenceFile` 取得可供本地 sandbox 读取的路径。

Chat 部署需应用新增版本化迁移。本地和云端共用 IAM 身份与 Admin 模型授权，不需要本地专属额度配置。接纳请求记录预留用量，完成后按 usage 结算；取消、崩溃或未知结果保留预留用量用于 accounting，不以独立日配额拒绝本地请求。重复请求与并发请求仍受准入保护；每次模型重试使用新的 request ID 和独立预留记录。

模型流在开始响应后中断时，Runtime relay 发送脱敏的 AI SDK 原生 `error` part 并完整结束 NDJSON；Desktop 遇到本机 HTTP body 截断时使用同一终态语义，不把 `ERR_INCOMPLETE_CHUNKED_ENCODING` 等 Chromium 传输细节暴露给会话。如果中断发生在任何正文、推理或工具协议输出之前，本地 ToolLoopAgent 最多自动重连 3 次，使用约 200/400/800 ms 的指数退避并加入小幅抖动；界面显示当前次数，恢复后清除。第 4 次调用仍失败才终止本轮并提示用户。任何语义输出开始后都不自动重放，未知结果仍保留预留用量。

只支持 macOS 本地执行。工具命令和文件 helper 都先应用 Seatbelt；失败时拒绝执行。命令可联网，启动时使用最小环境，写入限于授权目录和运行时临时目录。后台子进程在命令完成、取消或父进程退出后清理。Node 由 Electron 自带；其他可执行程序受固定系统路径与授权目录限制，不能自动使用用户登录 shell、Homebrew 或读取用户家目录配置。文件保存使用内容 hash 检查冲突，不静默覆盖外部编辑；外部编辑器不参与本应用队列，因此这不是对所有本机进程的文件系统事务。

关闭/重载页面只断开订阅；“停止”会取消执行；退出应用会清理任务。异常退出后终止未完成工具，不自动重放副作用。目录监听提示 Agent 重读变更；文件每次读写仍受 OS 边界和内容 hash 保护。既有本地会话不迁移到云端；当前新会话流程创建的本地 thread 只在创建后直接打开，不进入共享云端历史列表。

utility runtime 意外退出时，main 只启动一次替代进程并重新打开同一 scope 的 SQLite journal；出错中的 IPC 明确失败且不自动重放，恢复完成后页面重载权威会话。替代进程再次退出则 fail closed，要求重启应用，避免崩溃循环。

Agent 核心与云端共用 `@repo/agent-runtime` 的 `RuntimeTurn`、input queue、context manager、tool scheduler 和 AI SDK loop adapter。`electron/runtime/session-manager.ts` 只管理本地 journal、工作区、relay、sandbox 和流订阅；文件操作使用同一个 Bash manifest、ToolOutcome 与终端 UI，不维护本地专属文件工具。审批响应、待审批判断及取消/异常退出后的工具终态复用共享 lifecycle；本地 IPC 与云端 SSE 只是 transport adapter，不产生第二套 Agent 协议。

插件 catalog/release/installation/activation 与凭据边界见
[Agent plugin ADR](../../../../docs/ADR/agent-plugins.md)。

## 发行验收 TODO

- [x] 安装包内置 Platform 与 MFE 前端资源，使用受限自定义协议和固定 API 网关，并保持同一 preload capability 契约。
- [ ] 完成签名、公证、更新签名与升级回滚验收，并在支持的 macOS/架构矩阵上复测 Seatbelt 和后台进程回收。原生 supervisor 使用 macOS sandbox SPI；每次启动探测能力，不能将单机测试视为所有系统版本的保证。

当前打包命令生成资源自包含、ad-hoc 签名的内部正式包；它不代表已通过 Developer ID 签名、Apple 公证、真实 provider 联通或所有支持系统版本验收。

验证：`just test frontend/desktop`、`just test frontend/chat`、`just build desktop`、 `just build chat`。原生测试需要 macOS，其他平台跳过不代表验证通过。

架构决策见 [本地/云端执行模式 ADR](../../../../docs/ADR/sandbox-execution-modes.md)。
