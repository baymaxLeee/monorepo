# 当前决策：跨技术栈内部 API

状态：当前。范围：Monorepo 内跨服务同步调用。

## 决策

跨服务同步 API 统一使用 Proto 作为事实源、标准 gRPC 作为传输。契约位于
[`schemas/proto`](../../schemas/proto)，Buf 同时生成 Go、TypeScript 与 Python
绑定。Go 是新业务服务的默认实现语言，但 wire contract 不属于任何语言、服务
源码目录或部署 scope。

调用链固定为：

```text
application → service-local port/facade → generated gRPC client
            → shared protocol runtime → generated server adapter → application
```

- Proto 只表达 wire message、RPC、枚举和跨服务稳定语义；
- service-local facade 负责领域映射、缓存、组合调用与 operation-specific policy；
- `inner-api-{go,ts,py}` 只拥有生成绑定和 deadline、取消、trace、caller metadata、
  状态码等协议能力，不包含领域模型；
- 服务端 adapter 负责 caller allowlist、wire 校验和应用错误到 gRPC status 的映射；
- 服务不导入另一服务源码，也不读取另一服务数据库。

当前 RPC 端口为 Admin `9001`、Knowledge `9010`、Canvas `9012`、Storage
`9013`。本地使用 `localhost:<port>`，容器/Kubernetes 使用服务 DNS。所有端口
均可使用明文 HTTP/2（h2c）；单 VPS 与 localhost 不要求 service mesh、sidecar、
托管网关或额外证书成本。公网 TLS 仍由现有 edge/nginx 终止，RPC 端口不暴露公网。

## 有意保留的 HTTP 边界

- Gateway → 业务服务：公网 HTTP 反向代理边界；
- 浏览器上传 capability、签名媒体下载、公开 REST API；
- Chat → Runtime：端到端 UIMessage/SSE 流式代理，保持请求体和响应流不缓冲；
- Runtime server → worker/sandbox role：同一服务的独立进程协议，保留任务 SSE、
  命令和字节流语义，后续只有在不改变生命周期语义时才可改为 RPC。

这些例外不是通用 inner API，也不得重新承载 Admin、Knowledge、Canvas、Storage
的跨服务业务调用。旧 `/internal/*` HTTP route、OpenAPI S2S client、共享 token map
及 consumer-specific 生成目录均已删除，不提供兼容窗口或双写。

## 身份、可靠性与错误

- caller 名称由进程启动配置固定，经 `x-caller-service` metadata 自动注入，业务
  参数不能覆盖；服务端按 RPC method 做 allowlist；
- tenant、workspace、user 等资源身份是显式 Proto 字段，owner 继续做 scope 校验；
- trace metadata、deadline 与取消由共享 runtime 传播；所有 unary 和 stream 调用
  必须有总体 deadline，长流允许 operation-specific 上限；
- mutation 默认不由 transport 自动重试。只有契约和幂等键明确保证幂等时才可在
  总体 deadline 内做有限重试；durable relay 仍由业务 state machine 重试；
- 应用错误映射为规范 gRPC code；需要机器可读细节时使用标准 status details，日志
  不记录 provider credential、签名密钥或敏感 payload。

当前单 VPS/本地部署依赖私有网络隔离和不可公网访问的 RPC 端口。若未来出现跨主机、
不可信网络或多租户集群，再在不改变 Proto 契约的前提下增加 mTLS/workload identity；
这不是当前低成本部署的强制依赖。

## 演进与验证

字段号永不复用；删除字段必须 `reserved`；枚举保留 unspecified 零值；破坏性协议
变更使用新 package version。终态重构允许直接删除旧实现，但合并后的当前契约仍按
上述规则演进。

`just sync` 运行 Buf 生成、公开 OpenAPI、前端 client 与 SQL codegen；生成漂移由
`just sync-check` 拒绝。契约变更必须验证 producer adapter、每个真实 consumer、caller
授权、deadline/取消、流式失败清理和本地/容器目标。`services.yaml` 声明依赖与 RPC
端口，工具同时校验 `.env.example`、Kubernetes 和 Single-VPS 的 target 一致性。
