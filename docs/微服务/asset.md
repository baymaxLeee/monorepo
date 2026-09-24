# Asset

Asset 是 Go 实现的平台文件控制面，监听 `8013`。它是唯一能看到物理存储 locator
并直接读写 durable bytes 的应用服务；首个生产 adapter 是 Single-VPS/K8s 独占持久卷
上的本地文件系统，不依赖云对象存储。

## 职责

- `Asset -> immutable Revision -> content-addressed Blob` 身份与元数据。
- 上传 session、流式限额与 SHA-256、同卷原子 promotion、Range/conditional delivery。
- tenant/workspace scoped Claim 投影与 `strong | snapshot | lease | weak` 生命周期。
- abandoned staging cleanup、claim-count reconciliation、retention 与 fenced physical GC。
- capability URL；物理路径、bucket/key 和存储凭据永不离开 Asset。

## 调用约定

浏览器上传由 Canvas、Knowledge、Admin 各自的 prepare/finalize API 编排，不存在允许浏览器
自行选择 category 的通用 Asset 上传接口。领域 prepare 返回不透明 upload plan；浏览器通过
`PUT /api/asset-server/upload-sessions/{id}/content` 将同一个文件直接流式传给 Asset，再调用领域
finalize。session 绑定 caller service、tenant/workspace/user、用途 category、文件名、媒体类型、
精确字节数和过期时间，签名 URL 只是该 session 的短期 bearer capability。

prepare 的 `client_ref` 是幂等键：页面重载后用同一引用重试会返回原 session 及其状态，已完成
时无需重传。前端在任何一步中断都不会产生业务记录；未完成 staging 会被清理，已完成但未被
领域 Claim 接纳的 Revision 由 upload lease/retention 后续回收。在领域 finalize 成功前，上传
结果不是可见业务资源。

服务产生的 bytes 通过 `/internal/assets` 流式上传，携带 caller-specific workload token 和稳定
`idempotency_key`。重试必须复用同一 key；请求元数据不一致时 Asset 返回冲突，已完成的
请求直接返回原 revision，不再读取 body。describe、content、delivery capability 和 Claim API
同样走 `/internal/*`。业务服务只保存 `asset_id + revision_id`，并在自己的数据库事务内写
durable Claim intent；relay 至少一次投递，Asset 按 owner identity + generation 幂等收敛。

## 本地文件系统生产约束

`ASSET_DATA_DIR` 必须是 Asset 独占的持久卷。服务以 256 KiB buffer 流式处理大文件，
不把完整文件载入内存。单 writer volume 不支持多副本同时写；扩容到多副本前应换成
具备共享一致性语义的文件系统或新增对象存储 adapter。数据库与 byte volume 必须做
一致恢复点备份，只有物理删除确认后才清理元数据。

完整状态机、安全约束与消费者矩阵见 [ADR-0072](../ADR/0072-platform-asset-control-plane.md)。
