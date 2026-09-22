# Canvas Studio persistence 500 修复计划

日期：2026-09-22
状态：已完成

## 事实

- Studio 图读取和资源列表可稳定复现 `PersistenceError` 500。
- PostgreSQL 日志显示 `operator does not exist: character = uuid`。
- 最终 `v1.0.0.sql` 中 `assets.id` 及其他 Canvas 业务 ID 均为 `character(36)`，只有 `asset_references.asset_id` 被错误定义为 `uuid`。
- 图读取、资源读取、节点素材关系和上传后的引用建立共用资产引用仓储，因此该 schema 错误会同时破坏多个产品链路。

## 决定

- 将 `asset_references.asset_id` 直接改为 `character(36)`，与 `assets.id` 和所有引用方统一。
- 不在查询中增加 cast，不增加兼容 migration、双类型支持或运行时适配。
- 项目无数据兼容要求，修改最终首次 migration 后清库重装。

## 验证

1. 已重建 Canvas 数据库，`assets.id` 与 `asset_references.asset_id` 均为 `character(36)`。
2. 已经 Gateway 回归项目、Canvas、空图读取、资源分页和资源统计。
3. 已回归文本节点创建、PNG 上传、上传素材节点创建、含素材图读取和资源创建；所有请求返回 200。
4. 回归期间 PostgreSQL 与 Canvas 日志没有新增 SQL/500 错误。
5. 验收项目已删除，Canvas 业务表无残留项目、Canvas、节点、资产或资产引用。
6. Canvas `go test ./...`、`go vet ./...`、根 `just lint`、根 `just build` 与 `git diff --check` 均通过。
