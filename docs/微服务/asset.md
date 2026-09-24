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

浏览器上传的目标协议如下；各领域的 initiate/finalize API 尚需逐个迁移，当前通用
`POST /api/asset-server/assets` 不是最终业务契约。浏览器的 bytes 经 Gateway 直接进入 Asset，
不经业务服务中转。业务上下文必须由领域服务
编排：领域 initiate 返回不透明 upload plan，浏览器执行传输，领域 finalize 在业务事务内
落库并写 Claim intent。前端中断时只遗留有 TTL 的 upload lease/staging；定时清理即可，不影响
业务正确性。在领域 finalize 成功前，上传结果不是可见业务资源。

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
