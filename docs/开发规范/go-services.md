# Go 微服务模板

本模板适用于 `apps/backend/services/<name>`。技术选型由
[Go 服务平台 ADR](../ADR/go-service-platform.md) 统一管理；服务只能按需选择能力，
不能为同类能力替换另一套 router、ORM、logger、config 或 tracing framework。

## 标准目录

```text
services/<name>/
├── AGENTS.md
├── Dockerfile
├── go.mod
├── sqlc.yaml                         # 仅数据库服务；数据库服务必须存在
├── migrations/v1.0.0/               # 仅数据库服务
├── cmd/server/main.go                # signal context + bootstrap.Run
├── cmd/worker/main.go                # 可选独立 role
└── internal/
    ├── bootstrap/
    │   ├── config.go                 # caarlos0/env typed config + Validate
    │   └── run.go                    # 唯一 composition/lifecycle root
    ├── api/http/                     # 原生 Gin handler/middleware + generated binding
    ├── api/rpc/                      # 需要时实现 generated gRPC service
    ├── application/                  # use case 与 consumer-owned ports
    ├── domain/                       # 只有真实、无框架的 invariant
    └── infrastructure/
        ├── persistence/
        │   ├── sql/*.sql             # sqlc query 事实源
        │   ├── sqlc/                 # 生成输出，不手改
        │   └── repository.go         # pgx transaction orchestration + mapping
        └── <outbound-adapter>/
```

## 按需能力矩阵

| 需求 | 必须采用 | 禁止另选 |
|---|---|---|
| HTTP | `httpserver-go` + `gin/v1`；OpenAPI operation 生成 `gin-server` | Chi、Echo、Fiber、Gorilla router、`gin.Default`、手写重复 DTO/通用 middleware |
| 配置 | `caarlos0/env/v11` typed struct；dotenv 只负责本地文件加载 | Viper、Koanf、散落 `os.Getenv`/静默 fallback parser |
| 日志 | 标准库 `log/slog` | Zap、Logrus、Zerolog 及 service-local logger framework |
| Trace/metrics | `observability-go` + OpenTelemetry HTTP/gRPC instrumentation | 私有 trace header 实现、供应商专用 tracing SDK |
| PostgreSQL | `pgx/v5` pool/transaction + `sqlc` query codegen | 运行时 ORM、sqlx 或并行的 database/sql driver |
| Redis | `redis/go-redis/v9` | 第二套 Redis client |
| 内部 RPC | 官方 Proto + gRPC generated types + `inner-api-go` runtime | 手写 JSON RPC DTO、服务源码导入 |
| 外部 HTTP contract | canonical OpenAPI artifact + 固定版本 generator | 运行时反射生成作为唯一事实源 |
| 校验 | transport schema/codegen；确需运行时 JSON Schema 时用 `jsonschema/v6` | 多套 validator tag DSL |
| ID | 已有 contract 格式优先；新无序 ID 默认 UUIDv7 (`google/uuid`) | 在 persistence adapter 临时发明格式 |
| 并发 | `context` + `errgroup`，所有 goroutine 有 owner/cancel/wait | fire-and-forget goroutine、无界 channel |
| 测试 | `testing` + race；真实 PostgreSQL/Redis 边界用 Testcontainers | ORM mock 证明 SQL/transaction 正确性 |
| AI/tool | 官方 MCP Go SDK、官方模型 SDK；只有 runtime owner 才评估 Eino/Genkit | 业务 CRUD 服务引入 AI orchestration framework |

图像、Excel、云厂商 SDK 等领域专用库不要求所有服务安装，但必须只有真实 consumer，
不得承担上表已有的通用能力。引入前确认最新 stable、context/cancellation、维护活跃度和
生成/类型边界；版本写入 service `go.mod`，workspace policy 防止多个 consumer 漂移。

## 最小 bootstrap 约束

1. `main` 只创建 signal context、调用 `bootstrap.Run`、记录终止错误。
2. `config` 一次性解析 typed env；未知环境、非法 duration/size、生产默认密钥均启动失败。
3. `bootstrap` 先建立 observability，再建立 pgx/Redis/outbound clients，最后开放 admission。
4. 关闭顺序是 admission → HTTP/gRPC → workers → clients/pools → telemetry；每步有 deadline。
5. repository 接收 application-owned input/output；sqlc model 不越过 infrastructure 边界。
6. transaction 由 repository 明确拥有，retry 只在幂等且总体 deadline 内发生。

HTTP route 必须注册在共享 Gin engine。跨服务 middleware 的顺序和语义由
`httpserver-go` 唯一拥有；业务 handler 和 middleware 直接使用 `gin.Context`，解析后只把
普通值与 `context.Context` 传入 application。新增 middleware 要先判断是跨服务 invariant 还是服务专属策略，
并覆盖拒绝路径、panic、response 已开始和 streaming cleanup。

## 创建与验收

先按 [new microservice playbook](../../.agents/playbooks/new-microservice.md) 决定边界并注册
`services.yaml`，再复制当前最接近的合规 Go 服务结构。数据库服务创建 `sqlc.yaml` 后运行：

```text
just --justfile apps/backend/justfile gen-sql <name>
just check-go-modules
just test backend/<name>
just build backend/<name>
just check-repo
just lint
```

完成条件包括：独立 `GOWORK=off go mod tidy -diff`、race tests、生成幂等、Docker builder
toolchain 一致，以及 local/K8s/Single-VPS 配置和声明 binding 一致。缺失测试、跳过的真实
边界或只在 workspace 下可构建都不算通过。
