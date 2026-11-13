# Electron 本地工作区

Electron 通过 URL 加载现有 Platform，Chat MFE 同时提供云端会话和本地工作区。普通 Web 开发仍使用根目录 `just dev`；不会顺带启动 Electron。只启动单个前端时，在 `apps/frontend` 目录使用 `just dev platform` / `just dev chat`。

从仓库根目录运行：

```sh
just desktop-dev --platform-url=http://localhost:3000
just desktop-dev --platform-url=https://platform.example.com
# 仅用于验证 HTTP VPS；该连接没有传输加密，不用于正式分发。
just desktop-dev --platform-url=http://vps.example.com --allow-http
DESKTOP_PLATFORM_URL=https://platform.example.com just desktop-package
# 可选：让 App 和未来同机 CLI 使用指定的稳定本地运行时目录
MONOREPO_AGENT_HOME=/absolute/path/to/agent-home just desktop-dev
```

开发和打包都需要 macOS、Xcode Command Line Tools 与 `just install`。打包产物位于 `release/Monorepo-darwin-<arch>/Monorepo.app`，可直接从应用入口打开。URL 必须是 Platform 根地址，不能是单个 MFE；其网关必须提供同源 `/api/` 和 MFE 资源。默认值为 `http://localhost:3000`。不提供浏览器通用文件或命令接口。

登录后，只有 Desktop App 在 Chat 新建会话时渲染执行位置选择器；选择“本地电脑”后通过原生目录选择器授权目录。Web 不渲染该选择器并固定创建云端会话。云端会话由 Chat 持久化，可在 App 与 Web 继续；本地会话只属于当前本地主机，不上传或同步到 Web。文件直接在授权目录读写，不上传 Storage；本地 SQLite 保存会话，按 Platform origin、用户、租户和组织工作区隔离。模型推理所需上下文会发送给平台配置的 provider。服务端不保存本地会话/文件；只保存推理请求的授权和用量元数据。

本地 journal 不归属于某个 Electron 应用名。默认 runtime home 是 `~/.monorepo-agent`，会话数据库位于 `sessions/<identity-scope>/sessions.sqlite`；可通过绝对路径环境变量 `MONOREPO_AGENT_HOME` 覆盖，供同机 Desktop 与未来 CLI 指向同一 authority。首次打开身份分区时会一次性导入旧 Electron `userData/local/<scope>` 下开发版和打包版数据库，冲突保留 `updatedAt` 较新的完整会话；旧数据库暂不删除，已导入来源不会重复导入，因此删除的会话不会被旧库复活。runtime home 和 Electron `userData` 都属于 Agent 禁止访问的控制目录。

Chat 部署需应用新增版本化迁移。本地和云端共用 IAM 身份与 Admin 模型授权，不需要本地专属额度配置。接纳请求记录预留用量，完成后按 usage 结算；取消、崩溃或未知结果保留预留用量用于 accounting，不以独立日配额拒绝本地请求。重复请求与并发请求仍受准入保护，没有自动重试模型请求。

只支持 macOS 本地执行。工具命令和文件 helper 都先应用 Seatbelt；失败时拒绝执行。命令默认断网、最小环境、仅授权目录可写。后台子进程在命令完成、取消或父进程退出后清理。Node 由 Electron 自带；其他可执行程序受固定系统路径与授权目录限制，不能自动使用用户登录 shell、Homebrew 或读取用户家目录配置。文件保存使用内容 hash 检查冲突，不静默覆盖外部编辑；外部编辑器不参与本应用队列，因此这不是对所有本机进程的文件系统事务。

关闭/重载页面只断开订阅；“停止”会取消执行；退出应用会清理任务。异常退出后展示已持久化内容并终止未完成工具，不自动重放副作用。目录监听提示 Agent 重读变更；文件每次读写仍受 OS 边界和内容 hash 保护。本地与云端会话创建后模式固定，不迁移、不同步。

utility runtime 意外退出时，main 只启动一次替代进程并重新打开同一 scope 的 SQLite journal；出错中的 IPC 明确失败且不自动重放，恢复完成后页面重载权威会话。替代进程再次退出则 fail closed，要求重启应用，避免崩溃循环。

Agent 核心与云端共用 `@backend/agent-runtime-ts`。`electron/session-host.ts` 只管理本地 journal、工作区和流订阅；文件操作使用同一个 Bash manifest、ToolOutcome 与终端 UI，不维护本地专属文件工具。审批响应、待审批判断及取消/异常退出后的工具终态复用共享 lifecycle；本地 IPC 与云端 SSE 只是 transport adapter，不产生第二套 Agent 协议。

## 正式版本 TODO

- [ ] **将 URL 加载切换为安装包内置 Platform 与 MFE 前端资源。** 当前 URL 模式用于快速更新与 localhost/VPS 验证；正式发布时内置资源是目标，不作为两套长期并行入口。
- [ ] 内置模式使用受限自定义协议和明确的 API 网关地址，保持同一 preload capability 契约；验证离线查看本地历史、资源完整性及桌面/前端协议版本匹配。
- [ ] 完成签名、公证、更新签名与升级回滚验收，并在支持的 macOS/架构矩阵上复测 Seatbelt 和后台进程回收。原生 supervisor 使用 macOS sandbox SPI；每次启动探测能力，不能将单机测试视为所有系统版本的保证。

当前打包命令生成开发包，用于应用入口验收；正式分发流程待上述 TODO 落实。开发包不代表已通过签名、公证或真实 provider 联通验证。

验证：`just test frontend/desktop`、`just test frontend/chat`、`just build desktop`、 `just build chat`。原生测试需要 macOS，其他平台跳过不代表验证通过。

架构决策见 [本地/云端执行模式 ADR](../../../../docs/ADR/sandbox-execution-modes.md)。
