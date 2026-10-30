# 数据库升级、回退与数据迁移

业务数据默认持久保存，本地与 VPS 使用同一套版本化 SQL。服务拥有自己的数据库；
升级失败不能通过删除数据库、改 checksum 或跳过 migration 来处理。

## 已实现的执行契约

事实源是 [db-migrate.sh](../../scripts/db-migrate.sh)。服务在
`apps/backend/services/<service>/migrations/versions/` 保存 `v<major>.<minor>.<patch>.sql`，
按数字版本顺序执行。`v1.0.0.sql` 是不可变的初始 schema，后续修改新增文件。

- `migration` 的 `id=1` 保存当前版本；`migration_history` 保存每个已执行版本的
  SHA-256 和时间。已有单行记录的 `v1.0.0` 库只有 checksum 与原文件一致才能接入。
- 默认升级到文件集的最高版本；指定目标仅用于向上升级或验证同版本。
  已执行文件被修改/删除、补插旧版本、未知版本、历史缺口或降级请求都会失败。
- 同一数据库的升级由 PostgreSQL advisory lock 串行化。一次调用的待执行 SQL、
  当前版本和历史记录在一个事务中提交；失败全部回滚，重跑不会重复执行已提交 SQL。
  创建 database/role 属于事务外的初始化，不属于业务数据回滚范围。
- SQL 必须能在事务内执行，不能自行 `BEGIN`/`COMMIT`，不能把网络调用或大规模
  后台回填放进该事务。`CREATE INDEX CONCURRENTLY` 等非事务步骤不受此执行器支持，
  需要单独设计、验证和明确执行步骤，不能绕过版本记录。
- 应用启动不建表。`just up`/`just up-core` 和 VPS `db-init` 在应用接流量前执行迁移；
  单独重启 `just dev` 不代替迁移。

## 开发与发布

```bash
just migrate-up canvas           # 只升级 Canvas，保留所有业务数据
just migrate-up canvas v1.0.1    # 明确目标；不允许向低版本降级
just dev
```

发布变更应说明源版本、目标版本、涉及表、数据转换、旧应用兼容范围和失败恢复方法。
先在隔离数据库恢复代表性旧数据，运行升级、重复执行、失败回滚及业务读写验证。
本次 Canvas `v1.0.1.sql` 仅新增事件 checkpoint/日志表和索引，保留项目、画布、节点、
任务与生成历史；空库执行 `v1.0.0 → v1.0.1`，旧库仅执行 `v1.0.1`。

VPS 继续使用 [现有部署入口](../../infra/single-vps/README.md)，构建并发布包含全部
迁移文件的 `db-init` 镜像。不要设置 `RESET_DATA=true`。迁移失败时部署应停止，
先诊断原始 SQL 错误或历史差异，不能让新应用在缺表的库上启动。

需要保留的环境在发布前保留单服务备份，并验证能恢复到隔离库。Canvas 本地例子：

```bash
# 备份路径由操作者选择，不提交仓库；umask 限制文件可读范围。
umask 077
docker exec monorepo-postgres pg_dump -U canvas -d canvas -Fc > /secure-backup/canvas-before.dump
```

VPS 使用同样的单库 `pg_dump`，由部署环境提供连接凭据。备份不是自动回退许可；
恢复到过去的时间点会丢失备份后的写入。`pg_dump` 不包含集群角色或外部文件，
恢复时须保留对应 role/权限、稳定密钥与 Asset bytes；不能把单库恢复当跨服务一致恢复。
参见 [PostgreSQL SQL dump](https://www.postgresql.org/docs/16/backup-dump.html)。

## 回退和降级

| 情况 | 处理 |
|---|---|
| SQL 执行失败 | 执行器回滚本次待执行版本；修复尚未提交的 SQL 后重跑，已有业务数据保留。 |
| SQL 成功、新应用失败，旧应用兼容新 schema | 回退应用镜像，保留新 schema 与已应用的迁移历史。 |
| SQL 成功，需撤销 schema 或数据转换 | 新增向前修复 migration；保留可追踪的历史，不改旧 SQL/checksum。先证明旧数据仍可恢复。 |
| 转换不可逆或需恢复到指定时间点 | 停写并确认恢复边界，在独立库验证备份，核对备份后新增数据和外部资源，再决定切换；禁止直接覆盖活跃库。 |

**当前没有通用 `migrate-down` 或自动数据恢复功能。** 把低版本传给 `migrate-up`
会被拒绝。删除列不能靠添加同名列还原数据；Git 回退代码也不会回退数据库。
需要物理降级时必须提供该变更专用的恢复步骤、数据可逆性证明与测试，不能生成一个
未经验证的 `DROP TABLE` DOWN 脚本就声称支持回滚。

应用回退必须使用仍认识当前 schema 的迁移镜像。VPS 可单独固定 `DB_INIT_IMAGE_TAG`：

```bash
IMAGE_REGISTRY=ghcr.io/<owner>/<repo> \
IMAGE_TAG=<已验证兼容的旧应用SHA> DB_INIT_IMAGE_TAG=<当前schema对应的SHA> \
./infra/single-vps/deploy.sh <user>@<host>
```

这个选项只分离业务库迁移镜像，不证明任意旧版本兼容，也不替代 Workflow World
自身的版本要求。K8s 回退应用 Deployment 时同样保留兼容的迁移 Job，不执行不存在的
DOWN 脚本。本次 Canvas 的新增表可保留供旧代码忽略，回退不需要删事件表。

## 有历史数据的结构转换

对改字段、改类型、拆表和跨服务搬数据，先定义业务等价性与切换条件，再执行：

1. 扩展 schema，保留旧字段/旧读路径。若部署期间新旧应用并存，验证双方读写兼容。
2. 在拥有数据的服务内回填。小规模转换可随 SQL 事务执行；大规模转换使用服务内
   可重入批处理，保存 checkpoint，使用稳定主键范围，并处理回填期间的并发写入。
   不能以最后一批成功代替全量完成。
3. 对账记录数、关键字段/聚合值、NULL、唯一性与引用关系；校验条件来自业务不变量。
   批处理应覆盖中断重跑、重复处理及跨 tenant/workspace 隔离。
4. 切换读写并观察，再在后续版本收缩旧结构。清理前确定旧应用回退窗口已结束，
   且原始数据仍有可验证的恢复路径。

双写只在转换窗口内存在，明确事实源和去重键。跨服务迁移通过所有者的导出/导入或
声明的 transport 完成，不能让运行中的服务访问另一个服务的数据库。
当前没有通用大规模回填平台；这些步骤由具体服务实现，不能在文档中当作已有功能。

## 验证与维护

- `just test-db-migrations`：独立 PostgreSQL 容器中的旧库升级、新库安装、Docker/TCP
  两种传输、数字排序、checksum、重复执行、失败回滚和并发升级。
- `just test tooling`：公共 CLI 的输入与失败边界；`just check-repo` 检查导航。
- 修改 SQL 后还需跑对应服务的行为测试和构建。迁移测试不证明业务代码与旧数据兼容，
  镜像构建也不证明真实 VPS 已升级。

维护原则参考 [Anthropic 的迁移实践](https://claude.com/resources/articles/ai-code-migration)：
先定义可执行的等价性检查，并用错误样例证明检查有效。
参考 [OpenAI Harness engineering](https://openai.com/index/harness-engineering/) 的短入口、
单一文档事实源和机械校验，将规则留在所属 AGENTS，将操作流程维护在本文；旧决定留给 Git。
这两项是代理工程实践，不是数据库可逆性的保证。事务与锁行为以
[psql](https://www.postgresql.org/docs/16/app-psql.html) 和
[PostgreSQL advisory locks](https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS) 为依据。
