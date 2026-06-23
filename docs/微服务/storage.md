# Storage Service

`storage` 是 Go 实现的对象存储边界服务。当前 demo / single-VPS 版本使用本地
filesystem backend，MySQL 只保存 object metadata；未来可在服务内部切换到
S3-compatible backend，而调用方 API 不变。

## API 形态

内部 API 参考 S3 的 bucket/object 语义，但只实现当前业务需要的子集：

- `PUT /internal/buckets/{bucket}/objects/{key}`：上传或覆盖对象
- `GET /internal/buckets/{bucket}/objects/{key}`：下载对象，支持 Go 标准库 Range
- `HEAD /internal/buckets/{bucket}/objects/{key}`：读取 metadata
- `DELETE /internal/buckets/{bucket}/objects/{key}`：删除对象
- `POST /internal/objects`：multipart 便捷上传，服务端生成 object key

所有 `/internal/*` 请求必须携带 `X-Internal-Token`，值与
`INTERNAL_API_TOKEN` 一致。公网不直接暴露 storage；业务服务完成用户鉴权后再调用
storage。

## 数据模型

`storage_objects` 保存：

- `bucket`
- `object_key`
- `etag`
- `sha256`
- `size_bytes`
- `content_type`
- `content_disposition`
- `metadata_json`
- `owner_user_id`
- `storage_path`

对象 bytes 存储在 `STORAGE_DATA_DIR` 下。single-VPS 默认挂载 Docker volume 到
`/data/storage`。

## 迁移策略

第一阶段：

```text
chat -> storage-server -> local filesystem
```

后续如需迁移云对象存储：

```text
chat -> storage-server -> S3/OSS/COS backend
```

chat 不直接依赖 MinIO、OSS、COS 或 S3 SDK，只依赖 storage-server 的内部 API。

