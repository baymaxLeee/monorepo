# 当前决策：身份、作用域与配置

状态：当前。以服务数据模型和路由为依据，不沿用旧 Org 命名或虚构审计服务。

## 身份边界

IAM 拥有账号、凭据、tenant、workspace、成员关系、角色、登录会话和选中的
workspace。Admin 拥有作用域内的运营配置：Bot、provider、Skill、应用注册和
套餐等；管理 UI 不意味着 Admin 拥有 IAM 的身份数据。

Gateway 验证 IAM 签发的身份，剥离调用者伪造的身份头，再传递认证后的
tenant/user/workspace/roles。服务必须检查作用域与资源权限，资源 ID、前端
隐藏按钮、工具参数或 internal caller 身份都不能单独授予业务权限。

服务间使用显式 binding、`X-Caller-Service` 和每 caller 独立 credential，接收方
使用自己的允许映射验证。Gateway 不公开代理 downstream `/internal/*`；
Executor 没有公共 Gateway route。内部 API 的解密配置不能原样返回浏览器。

## Provider 与 Skill

Provider 凭据在 Admin 加密保存；公开形态脱敏，内部调用经 caller 与业务 scope
授权。连接测试验证声明的协议/能力。文本模型 dialect 显式配置，token 单位在
公开配置边界换算；数据库/内部契约保持精确值。URL、超时、预算等策略要有
真实产品或运行约束，不靠模型命名猜能力。

Skill 编辑文件树与唯一已发布快照由 Admin 拥有；发布原子覆盖，消费者只加载
启用的发布快照。文本可精确编辑，binary/ZIP 使用 Asset revision 与 snapshot
Claim。执行时初始只暴露 metadata，激活后逐步披露资源；服务启动不隐式同步
远端仓库。Bot 是结构化 profile，不能配置任意系统指令覆盖代码权限层。

授权、审计和事务由资源所属服务承担，不引入不存在的统一 audit 服务或通用
权限 mega-SDK。共享 transport 传递身份，不拥有业务模型或授权决策。

## 取舍与验证

显式 scope 和 caller credential 增加传输/配置工作，但避免一个共享 secret
代表所有 workload，也避免把模型输出当成可信身份。缓存不能取代 owner，
每次需要的可变权威引用按所属服务契约刷新。

入口：[IAM application](../../apps/backend/services/iam/internal/application)、
[Gateway auth](../../apps/backend/services/gateway/internal/api/http/middleware/auth.go)、
[Admin application](../../apps/backend/services/admin/src/application)。
验证跨 tenant/workspace 拒绝、伪造头剥离、未知 caller、缺省/无效配置、
凭据公开脱敏与审批拒绝；契约变化同时验证生成客户端与消费者。
