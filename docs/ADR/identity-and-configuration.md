# 当前决策：身份、作用域与配置

状态：当前。以服务数据模型和路由为依据，不沿用旧 Org 命名或虚构审计服务。

本地 Agent 的推理与凭据边界见 [Sandbox 执行模式](sandbox-execution-modes.md)：本地运行循环、
Runtime 提供受约束的 inference relay、provider secret 留在服务端；Chat 只代理 Web 产品 wire surface。
本地模式不改变 IAM/Admin 所有权。Relay 默认关闭，须配置显式推理配额。

## 身份边界

IAM 拥有账号、凭据、tenant、workspace、成员关系、角色、登录会话和选中的
workspace。Admin 拥有作用域内的运营配置：provider、Skill、应用注册和
套餐等；管理 UI 不意味着 Admin 拥有 IAM 的身份数据。

Gateway 验证 IAM 签发的身份，剥离调用者伪造的身份头，再传递认证后的
tenant/user/workspace/roles。服务必须检查作用域与资源权限，资源 ID、前端
隐藏按钮、工具参数或 internal caller 身份都不能单独授予业务权限。

类型化内部 RPC 使用显式 Proto/gRPC binding。client runtime 注入不可覆盖的固定 caller
与 workload credential，接收方先认证 workload，再按精确 caller-method matrix 授权。
Gateway 不公开代理 RPC 端口；
Runtime server、worker、sandbox 都没有公共 Gateway route。内部 API 的解密配置不能原样返回浏览器。

Runtime 是 tenant-neutral 的执行服务例外：Chat/Desktop/Canvas 等产品宿主先完成 tenant、workspace、
user membership、资源权限、模型与插件选择，再向 Runtime 传递冻结的 Session capability 或去密 snapshot。
Runtime 只校验 workload caller、Session/Turn 关联及 capability 的 audience、operation、resource、expiry 与
attempt binding；它的 API、数据库、恢复 envelope 和 plugin context 不接收或持久化产品身份，也不承担
上层租户隔离。Chat 到 Runtime 的 HTTP adapter 不转发任何 `X-Auth-*`。

浏览器认证生命周期统一由 Platform 的 `src/auth/` 拥有：登录、注册、刷新、
退出、workspace 切换和桌面凭据绑定均在这里完成；access token 与刷新中的
Promise 只保存在 Platform 模块内存。页面不得直接调用生成 IAM 登录/退出/切换
操作而绕过会话提交或清理。普通身份查询仍使用生成客户端。

`@repo/runtime` 只保存 Platform 注册的鉴权能力入口，不保存凭据、刷新任务或
IAM 请求实现。按应用打包的 `@repo/api` 通过该入口获取请求凭证和请求刷新，
Chat 用户菜单也通过它请求退出与切换 workspace，避免跨应用源码依赖。
不得通过 localStorage/sessionStorage 持久化 token 来弥补模块隔离。
回归测试见 [Platform session tests](../../apps/frontend/apps/platform/src/auth/session.test.ts)。

## Provider 与 Skill

Provider 凭据在 Admin 加密保存；公开形态脱敏，内部调用经 caller 与业务 scope
授权。连接测试验证声明的协议/能力。文本模型 dialect 显式配置，token 单位在
公开配置边界换算；数据库/内部契约保持精确值。URL、超时、预算等策略要有
真实产品或运行约束，不靠模型命名猜能力。

Skill 编辑文件树与唯一已发布快照由 Admin 拥有；发布原子覆盖，消费者只加载
启用的发布快照。文本可精确编辑，binary/ZIP 使用 Asset revision 与 snapshot
Claim。执行时初始只暴露 metadata，激活后逐步披露资源；服务启动不隐式同步
远端仓库。系统不提供可配置 Agent/Bot 或按 profile 装配运行时的能力。

授权、审计和事务由资源所属服务承担，不引入不存在的统一 audit 服务或通用
权限 mega-SDK。共享 transport 传递身份，不拥有业务模型或授权决策。

## 取舍与验证

显式 scope 和 caller allowlist 避免把网络可达性或模型输出当成可信身份。缓存不能取代 owner，
每次需要的可变权威引用按所属服务契约刷新。

入口：[IAM application](../../apps/backend/services/iam/internal/application)、
[Gateway auth](../../apps/backend/services/gateway/internal/api/http/middleware/auth.go)、
[Admin application](../../apps/backend/services/admin/internal/application)。
验证跨 tenant/workspace 拒绝、伪造头剥离、未知 caller、缺省/无效配置、
凭据公开脱敏与审批拒绝；契约变化同时验证生成客户端与消费者。
