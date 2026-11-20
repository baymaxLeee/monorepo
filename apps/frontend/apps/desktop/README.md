# Electron 桌面宿主

Electron 通过 URL 加载现有 Platform，并与 Web 渲染同一套 Chat 路由和组件。普通 Web 开发仍使用根目录 `just dev`；不会顺带启动 Electron。只启动单个前端时，在 `apps/frontend` 目录使用 `just dev platform` / `just dev chat`。

从仓库根目录运行：

```sh
just desktop-dev --platform-url=http://localhost:3000
just desktop-dev --platform-url=https://platform.example.com
# 仅用于验证 HTTP VPS；该连接没有传输加密，不用于正式分发。
just desktop-dev --platform-url=http://vps.example.com --allow-http
DESKTOP_PLATFORM_URL=http://124.222.245.5:8080/ just desktop-package
# 可选：让 App 和未来同机 CLI 使用指定的稳定本地运行时目录
MONOREPO_AGENT_HOME=/absolute/path/to/agent-home just desktop-dev
```

开发和打包都需要 macOS、Xcode Command Line Tools 与 `just install`。打包产物位于 `release/Monorepo-darwin-<arch>/Monorepo.app`，同时生成可下载的 `release/Monorepo-darwin-<arch>.zip`。正式打包会生产构建 Platform、Chat、Admin、Canvas，把资源写入 ASAR，并从受限 `app://platform` 协议加载；安装包不再依赖 VPS 上的前端静态文件，也不显示网关选择页。`DESKTOP_PLATFORM_URL` 是包内固定的 API authority，必须是 Platform 根地址；当前单 VPS 构建使用 `http://124.222.245.5:8080/`。自定义协议只把 `/api/*` 流式转发给该 authority，MFE 和其余资源只能从安装包读取。

显式传给开发入口的 `--platform-url` 仍直接加载 URL，默认值为 `http://localhost:3000`；远程 HTTP 必须带 `--allow-http`。应用不提供浏览器通用文件或命令接口。当前包会做完整 ad-hoc 签名和签名校验，但未使用 Developer ID、hardened runtime 或 Apple 公证，因此是可安装的内部正式构建，不是可对外无提示分发的 macOS 公证版本。

登录后，Desktop App 与 Web 使用完全相同的云端 Chat：相同的新会话 composer、`+` 文件选择与上传、会话历史、Artifact/视频 inspector 和 `/conversations/*` 路由。Chat 不读取 Desktop capability 来渲染执行位置、项目、本地历史、本地工作区或本地文件 UI，也不提供 `/local` 路由。此前写入的本地 SQLite 会话不迁移、不列出、不暴露兼容入口。

仓库仍保留 Electron native runtime 与受限 bridge 的底层实现，但当前 Chat renderer 没有本地会话或文件能力的调用方；这些实现不得被当成可见产品能力，也不得用于恢复 Desktop 专属 UI。

本地 journal 不归属于某个 Electron 应用名。默认 runtime home 是 `~/.monorepo-agent`，新
Thread/Turn/Item 数据库位于 `sessions/<identity-scope>/runtime.sqlite`；可通过绝对路径环境变量
`MONOREPO_AGENT_HOME` 覆盖，供同机 Desktop 与未来 CLI 指向同一 authority。这个 schema 是零兼容
切换：旧 `runtime-v1.sqlite`、`sessions.sqlite` 与旧 Electron `userData/local/<scope>` 不读取、
不导入，也不覆盖或删除。runtime home 和 Electron `userData` 都属于 Agent 禁止访问的控制目录。

保留的 Desktop bridge v5 在创建本地 Thread 时只接收 plugin IDs 和非秘密 bindings。每个
Turn 由 utility process 经 main → Chat BFF → Runtime 的 IAM-scoped `/local-inference/plugins/resolve`
通道解析当前 Admin installation；renderer 不接触 endpoint、header 或 token。去密的 manifest/
activation snapshot 在首次模型调用前写入本地 `turn_plugin_snapshots`，connection grant 只驻留 utility
进程内存。MCP tools 通过 AI SDK 原生 `tool_search` 懒披露，Turn 结束、取消或失败后释放。当前本地
验证面只有 `knowledge_search` 与只读 `get_canvas`；含插件 Skill 的 snapshot 因尚无受认证 asset
loader 而 fail closed。

Chat 部署需应用新增版本化迁移。本地和云端共用 IAM 身份与 Admin 模型授权，不需要本地专属额度配置。接纳请求记录预留用量，完成后按 usage 结算；取消、崩溃或未知结果保留预留用量用于 accounting，不以独立日配额拒绝本地请求。重复请求与并发请求仍受准入保护，没有自动重试模型请求。

只支持 macOS 本地执行。工具命令和文件 helper 都先应用 Seatbelt；失败时拒绝执行。命令可联网，启动时使用最小环境，写入限于授权目录和运行时临时目录。后台子进程在命令完成、取消或父进程退出后清理。Node 由 Electron 自带；其他可执行程序受固定系统路径与授权目录限制，不能自动使用用户登录 shell、Homebrew 或读取用户家目录配置。文件保存使用内容 hash 检查冲突，不静默覆盖外部编辑；外部编辑器不参与本应用队列，因此这不是对所有本机进程的文件系统事务。

关闭/重载页面只断开订阅；“停止”会取消执行；退出应用会清理任务。异常退出后终止未完成工具，不自动重放副作用。目录监听提示 Agent 重读变更；文件每次读写仍受 OS 边界和内容 hash 保护。既有本地会话不迁移到云端，也不在当前 UI 中显示。

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
