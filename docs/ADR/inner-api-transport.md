# 当前决策：跨技术栈内部 API

状态：当前。范围：Monorepo 内跨服务同步调用。

## 决策

需要稳定类型化方法的跨服务同步 API 使用 Proto 作为事实源、标准 gRPC 作为传输。
当前这条边界用于 Admin 与 Storage；契约位于 [`schemas/proto`](../../schemas/proto)，
Buf 同时生成 Go、TypeScript 与 Python 绑定。流式、MCP 或 HTTP 本身就是语义一部分
的边界保留原协议，具体边由 [`services.yaml`](../../services.yaml) 唯一声明。

调用链固定为：

```text
application → service-local port/facade → generated gRPC client
            → shared protocol runtime → generated server adapter → application
```

- Proto 只表达 wire message、RPC、枚举和跨服务稳定语义；
- service-local facade 负责领域映射、缓存、组合调用与 operation-specific policy；
- `inner-api-{go,ts,py}` 只拥有生成绑定和 deadline、取消、trace、caller metadata、
  状态码等协议能力，不包含领域模型；
- 服务端 adapter 负责精确 caller-method policy、wire 校验和应用错误到 gRPC status 的映射；
- 服务不导入另一服务源码，也不读取另一服务数据库。

当前 RPC 端口只有 Admin `9001` 与 Storage `9013`。本地使用 `localhost:<port>`，
容器/Kubernetes 使用服务 DNS。两个端口
均可使用明文 HTTP/2（h2c）；单 VPS 与 localhost 不要求 service mesh、sidecar、
托管网关或额外证书成本。公网 TLS 仍由现有 edge/nginx 终止，RPC 端口不暴露公网。

## 有意保留的 HTTP 边界

- Gateway → 业务服务：公网 HTTP 反向代理边界；
- 浏览器上传 capability、签名媒体下载、公开 REST API；
- Chat → Runtime：端到端 UIMessage/SSE 流式代理，保持请求体和响应流不缓冲；
- Runtime → Knowledge/Canvas：受固定 workload credential 约束的平台 MCP/HTTP
  能力边界，避免为同一能力保留第二套 gRPC server；
- Runtime server → worker/sandbox role：同一服务的独立进程协议，保留任务 SSE、
  命令和字节流语义，后续只有在不改变生命周期语义时才可改为 RPC。

这些例外不得旁路其现有身份与资源授权。没有真实 consumer 的 Knowledge/Canvas
gRPC server、端口、Proto 与生成包已经直接删除；不提供兼容窗口、双写或空壳协议。

## 身份、可靠性与错误

- caller 名称与 workload credential 由进程启动配置固定，经
  `x-caller-service` 与 `x-internal-token` metadata 自动注入，调用参数不能覆盖；
  服务端先以恒定时间比较认证 workload，再按精确 caller-method matrix 授权；
- 共享 runtime 的 workload 认证/授权拒绝除规范 gRPC code 外，还携带 domain 为
  `inner-api.monorepo` 的标准 `google.rpc.ErrorInfo`。consumer 只依据该 detail
  识别内部 credential 故障；应用层可合法返回相同的 `Unauthenticated` 或
  `PermissionDenied`，不得仅凭 code 将业务 401/403 改写成 502；
- tenant、workspace、user 等资源身份是显式 Proto 字段，owner 继续做 scope 校验；
- trace metadata、调用方 deadline 与取消由共享 runtime 传播；inner transport 不继承
  Gateway 的公共 60 秒默认值，也不在共享 client 上设置覆盖整个响应体的 blanket timeout。
  unary 由调用方给出总体 deadline；长流使用建连/首包、idle progress 和业务生命周期等
  operation-specific 上限，并允许健康流超过 60 秒；
- mutation 默认不由 transport 自动重试。只有契约和幂等键明确保证幂等时才可在
  总体 deadline 内做有限重试；durable relay 仍由业务 state machine 重试；
- 应用错误映射为规范 gRPC code；需要机器可读细节时使用标准 status details，日志
  不记录 provider credential、签名密钥或敏感 payload。

当前 localhost 与单 VPS 仍使用私有 h2c；credential 因此只可出现在进程 Secret，
不能经过不可信网络。Kubernetes 默认拒绝 ingress，并按 `services.yaml` 的调用边精确
开放目标端口，Gateway 只能访问命名 HTTP 端口。跨主机、不可信网络或多租户集群必须
在不改变 Proto 契约的前提下启用 TLS/mTLS 或平台 workload identity；共享 token 不是
免除传输加密的理由。

## 演进与验证

字段号永不复用；删除字段必须 `reserved`；枚举保留 unspecified 零值；破坏性协议
变更使用新 package version。终态重构允许直接删除旧实现，但合并后的当前契约仍按
上述规则演进。

`just sync` 运行 Buf 生成、公开 OpenAPI、前端 client 与 SQL codegen；生成漂移由
`just sync-check` 拒绝。契约变更必须验证 producer adapter、每个真实 consumer、caller
授权、deadline/取消、流式失败清理和本地/容器目标。`services.yaml` 声明依赖与 RPC
端口，工具同时校验 `.env.example`、Kubernetes 和 Single-VPS 的 target、credential
调用方集合及 token 值、每个 server/worker workload 的实际 ConfigMap binding 与
Kubernetes NetworkPolicy 一致性。生产 overlay 的 Secret 由集群外管理，部署在迁移和
rollout 前校验 live Secret 的必需 key 与完整 token 关系，且不输出 credential 值。
