# 当前决策：Turn-frozen Agent 插件

状态：当前。Admin 已拥有插件资源治理，Chat 已拥有产品选择，Runtime server 与 Electron utility
process 已通过同一个 `@repo/agent-runtime` 插件内核执行 MCP；旧的 Runtime 固定 Knowledge/Canvas
tools、私有 MCP provider 和按服务硬编码的插件装配不再是入口。

决策键：如何让系统内置能力和外部 MCP 使用同一套可安装、可审计、可取消且不泄露凭据的插件
生命周期，同时保持一个共享 Agent loop，而不引入 Agent/Bot/profile 工厂。

## 所有权与数据模型

插件不是 Agent。每个宿主仍运行唯一 shared loop 和 capability set，平台发布和个人本机安装都可贡献 MCP tools 与 Skills。

| 阶段 | Authority | 持久内容 | 禁止内容 |
| --- | --- | --- | --- |
| Catalog | Admin | 稳定 `name@marketplace` ID、展示信息、来源、trust、安装策略、availability | endpoint secret、运行中连接 |
| Release | Admin | 规范化 manifest、语义版本、内容 digest、固定 MCP endpoint、允许的 tools/schema/policy、Skill revision | 可变同 digest 内容、用户输入的临时 endpoint |
| Installation | Admin workspace | 选定 release digest、enabled、普通 config、加密 secrets、单调 revision | 明文 secret 回显、Runtime 私有副本表 |
| Personal installation | Desktop native | 当前登录身份的插件包副本、`name@local` ID | 云端分发、自动激活 |
| Activation | Chat/产品宿主 | `pluginId` 与 manifest 声明的非秘密 resource bindings | URL、header、credential、tool policy |
| Turn snapshot | Runtime/Desktop | workspace revision、不可变 release、activation 与 snapshot digest | connection grant、Authorization/token |
| Connection | 执行宿主内存 | Admin 解析出的短生命周期 headers/grant、MCP client | Chat、renderer、日志、PostgreSQL/SQLite snapshot |

Catalog 是全局可治理资源；installation 是 tenant/workspace 授权状态；activation 是某个会话选择；
snapshot 是某个 Turn 的冻结执行事实。安装、启停或换 release 只影响后续 Turn，不能在执行中替换
当前 tool schema。Admin revision 让 resolve 得到一致视图；Runtime 与 Desktop 都不复制 owner 表。

Release digest 覆盖 endpoint、贡献与策略。配置和 secret 属于 installation，不进入 release digest；
resolved snapshot digest 刻意排除 connection grants。持久化 projection 使用逐字段白名单，因此未来给
resolve 结果增加敏感字段也不会默认落库。

## 发布、安装与产品选择

Super admin 通过 Admin 管理面发布规范化 immutable release；workspace admin 安装、启停或卸载并
提供 manifest 声明的精确 config/secret 集合。Admin API 从不回显安装 secret。外部 MCP 不能声明
`system` trust，插件也不能把自己的 tool 提升为 closed trust；系统 release 必须同时是 `system`
source 与 `system` trust。

Admin 随发行包提供 `knowledge@platform` 与 `canvas@platform` 两个系统 release。其工具与权限清单见 [系统插件契约](../../schemas/mcp/system-plugins.json)。开发环境 bootstrap、Single-VPS one-shot 和 Kubernetes 发布 Job 在迁移后运行 Admin 的 `seed-plugins`，用当前部署的 MCP 地址计算 release digest 并发布到目录。发布新 release 或重跑同一版本都保留管理员的可见性、安装策略和工作区已选版本。工作区管理员选择是否安装和启用。普通用户在允许的会话范围内选择使用，画布宿主提供受信资源绑定。

普通 Chat 的创建会话页从 Admin 投影读取当前 workspace 已安装且 enabled 的插件，按默认策略勾选，用户可调整。Admin 以 `cloudOnly` 标记系统插件及含 Skill 的 release；本地模式禁选这些项，宿主 resolve 时独立执行同一限制。需要 required bindings 的插件
不能由普通会话凭空启用；产品宿主负责提供并验证资源上下文。Canvas 会话由 Chat 注入
`canvas@platform` 及 `project_id`/`canvas_id`，客户端提交不能覆盖该选择。Chat 数据库只保存选择和
非秘密 bindings，并在创建 Runtime Session 时投影为 `plugin_activations`。

当前内置验证面严格限制为：

- `knowledge@platform` 的 MCP inventory 只有 `knowledge_search`；
- `canvas@platform` 的 MCP inventory 只有只读 `get_canvas_context`；
- 旧 Canvas 更新、节点生成、故事板提交和 Runtime 内建 Knowledge search 不保留 alias 或 fallback。

桌面端“此计算机 → 插件”允许通过原生目录选择器导入单个插件包。安装只发布在当前身份的本机目录中，新会话可以独立勾选个人插件和可在本机运行的平台插件。云端请求只携带平台选择。本机支持 Agent Plugins v1 的 `plugin.json` 与 Codex 的 `.codex-plugin/plugin.json`、Skill 正文和 `references/` 文本、HTTP MCP。导入时做静态校验。勾选后才向服务获取工具清单，权限以外部未知副作用处理。插件目录和 MCP headers 只供本机宿主读取。命令 Hooks、Apps 和 stdio MCP 尚无本机执行适配。

## Turn resolve 与执行生命周期

每个 Turn 在模型调用前执行以下顺序：

1. 宿主按来源解析 activation。本机来源由 utility process 读取，平台来源交给受信 resolver。云端 Runtime 直接调用 Admin；Desktop utility process 经
   Electron main、Chat BFF 和 Runtime 的 IAM-scoped native endpoint 到同一个 Admin resolve。resolve
   本身不附加 Runtime workload identity；云 Runtime 随后只为验证过 endpoint/source/trust 的平台插件
   在进程内追加凭据。Desktop 位于服务信任域之外，当前拒绝所有 `system` 插件，绝不接收共享服务 token。
2. Admin 在 actor 的 tenant/workspace/role 下检查 installation、enabled release 和 bindings，按
   release 声明把 binding/config/secret 映射为 headers；保留的内部身份 headers不能被插件覆盖。
   Runtime 只对固定 endpoint 的 `system` release 注入 workload token，并以该 token 签名完整身份、
   资源 binding、Turn ID 与 attempt epoch。Canvas/Knowledge 在 dispatch 前验证 token、audience、scope
   与 epoch；任一 header 替换都会 fail closed，connection grant 不能跨 lease owner 复用。
3. 宿主先持久化去除 grants 的 immutable snapshot，再让 shared `PluginManager` 校验 workspace、
   release、tool policy 与每个 server 恰好一个 grant。
4. MCP tool 以 `mcp__<server>__<tool>` 进入同一个 AI SDK `ToolLoopAgent`。定义默认
   `deferLoading: true`，首个 model step 只看见原生 `tool_search`，命中后下一 step 才暴露完整 schema。
5. 首次实际调用时用官方 `@ai-sdk/mcp` Streamable HTTP client 懒连接；远端 inventory、名称和 schema
   必须与 immutable release 一致，否则 fail closed。连接与 inventory 握手上限为 10 秒，`maxRetries: 0`；
   工具执行不使用共享硬超时，只服从 Turn cancellation 和 lease ownership，具体工具若有业务 deadline
   必须由其 contract 显式声明。
6. Turn 完成、失败或取消后按逆序 dispose；部分加载失败也释放此前已取得的 client。普通 MCP
   `isError` 作为统一 `ToolOutcome` 回到唯一 loop，取消和协议损坏不伪装成业务结果。

外部 MCP 返回的 annotations 或 `_meta` 不是授权来源，不能提升 trust、effect、execution 或
Code Mode 可见性。只有显式发布为 `read + inline + open-world` 的工具可声明
`callableByCodeMode`。tool name、schema 或 inventory 漂移必须发布新 release，不能运行时静默接受。

云端插件 Skill 通过 Admin/Storage 的 immutable asset revision 和 SHA-256 装载，initial instructions
只披露限定名和描述。限定名使用 `name@marketplace:skill`，避免不同来源发布同名 Skill 时冲突。首次加载与审批恢复都从本次快照和工作区组成的同一目录取正文。Desktop 从本机安装副本装载个人 Skill 并校验引用资源的内容摘要。含平台 Skill 的 release 仍需受认证的云端 asset loader。Knowledge/Canvas 系统插件只在云 Runtime 执行；未来若支持本地调用，
必须先建立 user/device-bound credential broker，不能复用 Runtime service credential。

## 本地持久化与安全边界

Desktop bridge 暴露原生安装与列表能力，返回 ID 和显示名。创建本地 Thread 时记录选中的 activation。Electron main 校验最多 16 个稳定 plugin IDs
及 bounded bindings；renderer 永远拿不到 manifest endpoint、headers 或 grants。utility process resolve
完成后，将去密 snapshot 写进 identity-scoped `runtime.sqlite` 的 `turn_plugin_snapshots`，再开始模型
调用。相同 Turn 的 snapshot 只能幂等重复写入，内容变化会失败；旧 `runtime-v1.sqlite` 不读取或迁移。
审批恢复（含应用重启后）沿用该 Turn 已保存的 snapshot。需要重建 MCP 连接时，宿主用原 activation
重新申请临时 grant，并核对 tenant、workspace、workspace revision 及完整的插件清单和绑定。
任一项变化就结束本轮，用户可在新轮次使用最新配置。

云端审批或客户端工具续跑生成新 run ID 时，在创建 run 的事务中从原 assistant item 所属 run 复制快照。新 attempt 必须持有效 lease 才能读取快照，并针对冻结的 activation 重新取得 grant。

云端 PostgreSQL 使用同名语义的 `turn_plugin_snapshots` 作为 audit/recovery 事实。两种持久层都不凭
snapshot 自动重放工具；崩溃恢复只恢复已提交 journal。connection grant 仅在执行进程内存中存在，
Turn cleanup、utility 退出或 Abort 都结束其可用生命周期。

## 取舍与一手依据

插件限定名与能力投影对照 [Codex plugin render](https://github.com/openai/codex/blob/d1d1ba0b837d34f314b7f469896e8babbc91f949/codex-rs/core/src/plugins/render.rs)。本仓库用完整市场 ID 作命名空间，Admin 发布不可变版本，执行宿主按 Turn 获取连接。

Codex 的公共插件目录和个人/仓库 marketplace 可以并存。本产品把用户选择放在新会话编辑器，直接导入插件包目录。[官方插件打包与 marketplace 指南](https://developers.openai.com/plugins/build/plugins)

本设计采用本地及当前 upstream Codex 中 stable plugin identity、manifest/load outcome、capability
projection、MCP binding 与 Turn-owned cleanup 的职责形态，并保持 Codex Thread/Turn/Item 的冻结上下文
原则；参考 [Codex app server](https://developers.openai.com/codex/app-server/) 和
[Codex harness](https://openai.com/index/unlocking-the-codex-harness/)。Anthropic 的
[plugin model](https://code.claude.com/docs/en/plugins/overview) 用于交叉检查“一个可安装包贡献 Skills
与 MCP”的产品边界；实际协议与执行使用官方 [MCP SDK](https://modelcontextprotocol.io/docs/sdk) 和
AI SDK，不复制供应商私有 prompt、wire format、marketplace 实现或许可证受限代码。

被否决：Runtime 内硬编码 Knowledge/Canvas clients、Chat/renderer 保存 URL/token、Admin 执行 MCP、
服务启动时隐式 seed、每插件一个 Agent、运行中热替换 release、自动重试非幂等 MCP 调用、把远端
annotations 当权限，以及为旧数据库或旧 tool name 保留双写/alias。

## 实现与验证边界

- shared contract/lifecycle：[plugin types](../../packages/agent-runtime/src/plugins/types.ts)、
  [manager](../../packages/agent-runtime/src/plugins/manager.ts)、
  [MCP loader](../../packages/agent-runtime/src/plugins/mcp.ts)、
  [persistence projection](../../packages/agent-runtime/src/plugins/snapshot.ts)
- Admin authority：[domain](../../apps/backend/services/admin/internal/domain/agent_plugin.go)、
  [application service](../../apps/backend/services/admin/internal/application/agent_plugins.go)、
  [HTTP adapter](../../apps/backend/services/admin/internal/api/http/agent_plugins.go)
- selection/resolve：[Chat projection](../../apps/backend/services/chat/internal/application/projection.go)、
  [Runtime run](../../apps/backend/services/runtime/src/application/agent/runs/run.ts)、
  [Desktop session manager](../../apps/frontend/apps/desktop/electron/runtime/session-manager.ts)
- system MCP surfaces：[Knowledge server](../../apps/backend/services/knowledge/src/api/mcp/server.py)、
  [Canvas server](../../apps/backend/services/canvas/internal/api/mcp/server.go)

最低验证包括 manifest/trust/binding 拒绝、immutable release、workspace scope、secret 不回显与不落库、
inventory/schema drift、lazy discovery、timeout/cancel、部分失败 cleanup、Turn snapshot 幂等、Chat
产品 binding 防覆盖，以及真实 Electron main/preload/utility smoke。生产环境部署执行、真实外部 MCP 可用性和 Desktop 平台 Skill asset loader 仍是独立后续边界，不能由 mock 单测表述为已完成。
