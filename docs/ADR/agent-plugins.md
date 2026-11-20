# 当前决策：Turn-frozen Agent 插件

状态：当前。Admin 已拥有插件资源治理，Chat 已拥有产品选择，Runtime server 与 Electron utility
process 已通过同一个 `@repo/agent-runtime` 插件内核执行 MCP；旧的 Runtime 固定 Knowledge/Canvas
tools、私有 MCP provider 和按服务硬编码的插件装配不再是入口。

决策键：如何让系统内置能力和外部 MCP 使用同一套可安装、可审计、可取消且不泄露凭据的插件
生命周期，同时保持一个共享 Agent loop，而不引入 Agent/Bot/profile 工厂。

## 所有权与数据模型

插件不是 Agent。每个宿主仍运行唯一 shared loop 和 capability set，插件只贡献经过发布审核的 MCP
tools 与 Skills：

| 阶段 | Authority | 持久内容 | 禁止内容 |
| --- | --- | --- | --- |
| Catalog | Admin | 稳定 `name@marketplace` ID、展示信息、来源、trust、安装策略、availability | endpoint secret、运行中连接 |
| Release | Admin | 规范化 manifest、语义版本、内容 digest、固定 MCP endpoint、允许的 tools/schema/policy、Skill revision | 可变同 digest 内容、用户输入的临时 endpoint |
| Installation | Admin workspace | 选定 release digest、enabled、普通 config、加密 secrets、单调 revision | 明文 secret 回显、Runtime 私有副本表 |
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

Admin 长服务启动时不隐式 seed 或 reconcile。当前系统插件允许 super admin 手工发布并由 workspace
admin 安装；未来 K8s pre-job 或 VPS one-shot seed 必须调用同一 application service，以相同 plugin
ID/release digest 幂等写入，不能让每个 Admin 副本在启动时修改 catalog。`installed-by-default` 只表示
一个已经安装且 enabled、又不需要业务 binding 的插件在新普通会话中默认选中，不等于自动发布或安装。

普通 Chat 插件选择器只列出当前 workspace 已安装且 enabled 的插件。需要 required bindings 的插件
不能由普通会话凭空启用；产品宿主负责提供并验证资源上下文。Canvas 会话由 Chat 注入
`canvas@platform` 及 `project_id`/`canvas_id`，客户端提交不能覆盖该选择。Chat 数据库只保存选择和
非秘密 bindings，并在创建 Runtime Session 时投影为 `plugin_activations`。

当前内置验证面严格限制为：

- `knowledge@platform` 的 MCP inventory 只有 `knowledge_search`；
- `canvas@platform` 的 MCP inventory 只有只读 `get_canvas`；
- 旧 Canvas 更新、节点生成、故事板提交和 Runtime 内建 Knowledge search 不保留 alias 或 fallback。

## Turn resolve 与执行生命周期

每个 Turn 在模型调用或 MCP 连接前执行以下顺序：

1. 宿主把 activation 交给受信 resolver。云端 Runtime 直接调用 Admin；Desktop utility process 经
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
只披露 name/description。Desktop 尚未接入受认证的 Skill asset loader；含 Skill 的 snapshot 在本地
执行 fail closed，不静默忽略。Knowledge/Canvas 系统插件只在云 Runtime 执行；未来若支持本地调用，
必须先建立 user/device-bound credential broker，不能复用 Runtime service credential。

## 本地持久化与安全边界

Desktop bridge v3 只把 activation 带入本地 Thread。Electron main 校验最多 16 个稳定 plugin IDs
及 bounded bindings；renderer 永远拿不到 manifest endpoint、headers 或 grants。utility process resolve
完成后，将去密 snapshot 写进 identity-scoped `runtime.sqlite` 的 `turn_plugin_snapshots`，再开始模型
调用。相同 Turn 的 snapshot 只能幂等重复写入，内容变化会失败；旧 `runtime-v1.sqlite` 不读取或迁移。
审批恢复（含应用重启后）沿用该 Turn 已保存的 snapshot。需要重建 MCP 连接时，宿主用原 activation
重新申请临时 grant，并核对 tenant、workspace、workspace revision 及完整的插件清单和绑定。
任一项变化就结束本轮，用户可在新轮次使用最新配置。

云端 PostgreSQL 使用同名语义的 `turn_plugin_snapshots` 作为 audit/recovery 事实。两种持久层都不凭
snapshot 自动重放工具；崩溃恢复只恢复已提交 journal。connection grant 仅在执行进程内存中存在，
Turn cleanup、utility 退出或 Abort 都结束其可用生命周期。

## 取舍与一手依据

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
产品 binding 防覆盖，以及真实 Electron main/preload/utility smoke。真实外部 MCP 可用性、K8s/VPS
seed job 和 Desktop plugin Skill loader 仍是独立后续边界，不能由 mock 单测表述为已完成。
