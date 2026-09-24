# Canvas

Canvas 是 Go 服务，监听 `8012`，拥有项目、画布、节点、素材、生成任务和用量记录；
业务元数据归 `canvas` PostgreSQL 数据库所有。媒体 bytes 由 `asset` 持久化，
durable 工作流交给 `executor`，模型与运营配置从 `admin` 获取，服务之间只走声明过的
HTTP binding。

## 运行配置

本地配置源是 `apps/backend/services/canvas/.env.example`。`staging`、`single-vps`
和 `production` 不允许使用本地默认值，必须显式提供数据库、Redis、内部令牌、三个
服务 binding 以及 `PUBLIC_GATEWAY_URL`。后者必须是浏览器可访问的 Gateway origin；
不能写容器内部地址或 `localhost`。`production` 要求 HTTPS。

Canvas 的 `/livez` 只表示进程存活；`/readyz` 和 `/healthz` 同时检查 PostgreSQL 与
Redis。K8s 的 readiness probe 必须使用 `/readyz`。

## 媒体链路

浏览器通过 Gateway 直接流式上传到 `/api/asset-server/assets`，再把 immutable
`asset_id + revision_id` 注册到 Canvas 的项目、画布、节点或素材业务记录。Canvas
在同一业务事务写 durable Claim intent，异步 relay 以 generation + CAS 保护地投递到
Asset。封面、归档、生成输入与产物都遵循同一模型，不再经过 Knowledge object API。
返回给浏览器或外部 provider 的短期 URL 由 Asset delivery capability 签发。
