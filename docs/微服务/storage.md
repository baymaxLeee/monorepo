# Storage

Storage 是 Go 实现的平台文件控制面，监听 `8013`。它是唯一能看到物理存储 locator
并直接读写 durable bytes 的应用服务；首个生产 adapter 是 Single-VPS/K8s 独占持久卷
上的本地文件系统，不依赖云对象存储。

## 职责

- `Asset -> immutable Revision -> content-addressed Blob` 身份与元数据。
- 上传 session、流式限额与 SHA-256、同卷原子 promotion、Range/conditional delivery。
- tenant/workspace scoped Claim 投影与 `strong | snapshot | lease | weak` 生命周期。
- abandoned staging cleanup、claim-count reconciliation、retention 与 fenced physical GC。
- capability URL；物理路径、bucket/key 和存储凭据永不离开 Storage。

## 调用约定

浏览器上传由 Canvas、Knowledge、Admin 各自的 prepare/finalize API 编排，不存在允许浏览器
自行选择 category 的通用 Storage 上传接口。领域 prepare 返回不透明 upload plan；浏览器通过
`PUT /api/storage-server/upload-sessions/{id}/content` 将同一个文件直接流式传给 Storage，再调用领域
finalize。session 绑定 caller service、tenant/workspace/user、用途 category、文件名、媒体类型、
精确字节数和过期时间，签名 URL 只是该 session 的短期 bearer capability。

prepare 的 `client_ref` 是幂等键：页面重载后用同一引用重试会返回原 session 及其状态，已完成
时无需重传。前端在任何一步中断都不会产生业务记录；未完成 staging 会被清理，已完成但未被
领域 Claim 接纳的 Revision 由 upload lease/retention 后续回收。在领域 finalize 成功前，上传
结果不是可见业务资源。

服务产生的 bytes 通过 `/internal/assets` 流式上传，携带 caller-specific workload token 和稳定
`idempotency_key`。重试必须复用同一 key；请求元数据不一致时 Storage 返回冲突，已完成的
请求直接返回原 revision，不再读取 body。describe、content、delivery capability 和 Claim API
同样走 `/internal/*`。业务服务只保存 `asset_id + revision_id`，并在自己的数据库事务内写
durable Claim intent；relay 至少一次投递，Storage 按 owner identity + generation 幂等收敛。

已拥有精确 strong Claim 的内部服务可调用 `POST /internal/assets/{assetID}/revisions`，以稳定
幂等键向同一 Asset 追加 immutable revision。请求绑定 base revision 与完整 owner/slot/generation；
Storage 在 staging 前和最终事务中复验 caller-owned Claim，锁定 Asset 后分配递增序号，并拒绝
`deleting`、`deleted`、`quarantined`。`current_revision_id` 只是 Storage 最近追加 head；业务服务
始终保存和读取明确的 `asset_id + revision_id`，不能用 head 推断业务当前版本。

## 预览与下载签发

下载授权由资源所属服务完成：Chat 检查会话和文件归属，Knowledge 检查文档可读性，
Canvas 检查项目权限，Admin 检查配置资源可见性。owner 调用
`POST /internal/delivery-capabilities:mint`，Storage 统一生成短期 capability，返回
`asset_id`、`revision_id`、`url`、`expires_at`、`filename`、`media_type`、`size_bytes`。
不存在仅凭 tenant/workspace 即可访问任意文件的公开签发或原件接口。
签发结果按 revision、变换参数、scope、签名 key 和 TTL 缓存；每次命中前重新校验资源状态，
Redis 不可用时直接签发。默认 TTL 为 6 小时，临近过期重新签发。

`GET/HEAD /api/storage-server/media/{assetID}/revisions/{revisionID}/content` 只校验 capability，
不要求浏览器在 img/video/iframe 上附加登录头。支持 Range/206、非法区间 416、ETag/If-Range
和条件读取；响应缓存时间不超过 capability 剩余有效期。追加 `download=1` 返回 attachment，
使跨域部署的浏览器也能直接下载。HTML/SVG/XHTML 设置 CSP sandbox，防止文件取得宿主同源权限。
内部 `delivery-capabilities:mint` 复用相同签发与缓存路径。签发返回 `Cache-Control: no-store`，
临时 URL 不写入消息或资源持久记录，日志与分析事件也不应记录它。

Storage 同时提供有界图片缩略图：内部读取或签发 capability 时指定 `max_dim`，
由 Storage 处理方向、等比缩放和 JPEG 编码。变换参数参与签名，不能换取原件或其他尺寸；
原件保持不变，Knowledge 不再持有图片处理或文件签名实现。

追加上传的执行租约为两分钟；过期 uploading 或 failed 重试使用新 upload ID，旧尝试转为 aborted 并保留清理记录。完成后恢复 24 小时上传幂等保留窗口，迟到的旧尝试不能提交新 revision。

## 本地文件系统生产约束

`STORAGE_DATA_DIR` 必须是 Storage 独占的持久卷。服务以 256 KiB buffer 流式处理大文件，
不把完整文件载入内存。单 writer volume 不支持多副本同时写；扩容到多副本前应换成
具备共享一致性语义的文件系统或新增对象存储 adapter。数据库与 byte volume 必须做
一致恢复点备份，只有物理删除确认后才清理元数据。

完整状态机、安全约束与消费者矩阵见 [docs/ADR/files-and-assets.md](../ADR/files-and-assets.md)。
