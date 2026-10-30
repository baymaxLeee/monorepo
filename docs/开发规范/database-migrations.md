# 数据库升级、回退与数据迁移

业务数据默认持久保存，本地与 VPS 使用同一套版本化 SQL。服务拥有自己的数据库；
升级失败不能通过删除数据库、改 checksum 或跳过 migration 来处理。

## 已实现的执行契约

入口是 [db-migrate.sh](../../scripts/db-migrate.sh)，执行器是
[Goose 适配层](../../scripts/dbmigrate/migrate.go)。服务在
`apps/backend/services/<service>/migrations/v<major>.<minor>.<patch>/` 保存迁移，
发布目录内按 `0、1、2…` 连续步骤执行，完整迁移 ID 为 `v<major>.<minor>.<patch>.<step>`。
`v1.0.0/v1.0.0.0.up.sql` 是不可变的初始 schema，同一发布开发期间追加步骤文件；新发布再建版本目录。
现有 SQL 原样重命名为 step `0` 的平铺文件，checksum 不变。数据库中旧三段 ID 仅作为对应 step 0 的别名识别，
不把它解释为当前发布的最后一步；历史和审计行不重写，新执行记录与当前 head 使用四段 ID。

- `migration` 的 `id=1` 保存当前版本；`migration_history` 保存每个已执行步骤的
  SHA-256 和时间。已有单行记录的 `v1.0.0` 库只有 checksum 与原文件一致才能接入。
- 默认升级到文件集的最高版本；指定目标仅用于向上升级或验证同版本。
  已执行文件被修改/删除、补插旧版本、未知版本、历史缺口或通过 UP 发起的降级请求都会失败。
- 同一数据库的升级由 PostgreSQL advisory lock 串行化。一次调用的待执行 SQL、
  当前版本和历史记录在一个事务中提交；失败全部回滚，重跑不会重复执行已提交 SQL。
  创建 database/role 属于事务外的初始化，不属于业务数据回滚范围。
- SQL 必须能在事务内执行，不能自行 `BEGIN`/`COMMIT`，不能把网络调用或大规模
  后台回填放进该事务。`CREATE INDEX CONCURRENTLY` 等非事务步骤不受此执行器支持，
  需要单独设计、验证和明确执行步骤，不能绕过版本记录。
- 应用启动不建表。`just up`/`just up-core` 和 VPS `db-init` 在应用接流量前执行迁移；
  单独重启 `just dev` 不代替迁移。

## SQL 与 Go 的选择

```text
migrations/
  v1.0.0/
    checksums.yaml
    v1.0.0.0.up.sql
  v1.0.1/
    checksums.yaml
    v1.0.1.0.up.sql
    v1.0.1.0.down.sql
```

这是本项目的版本聚合目录，不是 Goose CLI 原生文件布局。Goose 固定依赖版本，
通过 `NewGoMigration` / `GoFunc.RunTx` 执行完整计划；禁用其独立版本表，由适配层
保留现有版本、checksum 与审计协议，避免两套历史。锁在同一事务中获取。

- 默认 SQL：建表、索引、字段变更与可表达为 SQL 的小规模数据转换。
- 复杂但可在一次事务内完成的转换使用 Go：该步骤使用 `<release>.<step>.up.go` / `<release>.<step>.down.go`
  及必要的同包、同一步骤前缀的 helper，不同时放 SQL。没有逆操作时不注册 `Down`，不能注册空函数冒充恢复。
- Go 函数签名是 `func(context.Context, *sql.Tx) error`。使用传入事务，传播取消和错误，
  禁止自行提交、开启第二连接或调用外部 API；不要依赖会随业务演变的 ORM/model。
- 服务的 `cmd/migrate` 显式注册 `map[string]dbmigrate.GoMigration` 并调用 `dbmigrate.Main`。
  `Source` 用 `//go:embed *.go` 嵌入发布目录 Go 源文件，执行器按步骤前缀选取对应文件；执行器校验文件集合和内容
  与编译产物一致，未注册、混合 SQL/Go 或过期二进制都会拒绝。
  Go checksum 覆盖步骤内的全部 Go 文件，SQL checksum 保持原始文件 SHA-256。
- 可运行的注册与 JSON 转换例子见[测试迁移入口](../../scripts/dbmigrate/internal/testfixture/cmd/main.go)
  和[转换实现](../../scripts/dbmigrate/internal/testfixture/migrations/v1.0.1/v1.0.1.0.up.go)。它们只在测试库运行，
  不向业务库增加演示版本。服务通过 Go module 引用 `scripts/dbmigrate`（仓库内用相对 replace），
  本地入口检测 `cmd/migrate` 并构建服务迁移二进制。
- 部署时必须在构建阶段编译服务迁移二进制并打入镜像，使用 `DB_MIGRATE_BINARY` 选择，
  不能在生产临时 `go run`。当前业务迁移全是 SQL，镜像携带通用 SQL 二进制；
  引入首个服务 Go 版本时需同步镜像构建及服务入口的二进制选择。
- 长时间或跨系统数据搬迁使用服务拥有的独立 Go 回填任务，明确 checkpoint、幂等键、
  批量大小和对账条件；完成后才允许后续 schema 收缩，不能占用 DDL 长事务。

采用 [Goose 官方 Go 迁移 API](https://github.com/pressly/goose/blob/v3.26.0/migration.go)
复用事务执行能力。[OpenAI Codex](https://github.com/openai/codex/blob/main/codex-rs/state/src/migrations.rs)
采用 SQLx 迁移与 checksum 校验；[Anthropic email-agent 示例](https://github.com/anthropics/claude-agent-sdk-demos/blob/main/email-agent/database/migrations/README.md)
采用增量 SQL。这些实现支持版本化与数据保护方向，不代表两家公司规定了本项目的目录布局。

## 每版本 checksum 清单

每个发布目录提交 `checksums.yaml`，由工具按原始文件字节生成：

```yaml
version: v1.0.1
algorithm: sha256
steps:
  - version: v1.0.1.0
    checksum: <步骤文件集合摘要>
    files:
      v1.0.1.0.up.sql: <SHA-256>
      v1.0.1.0.down.sql: <SHA-256>
```

每个 step 的 `files` 列出该步骤全部 SQL 或 Go 文件；`checksum` 是按文件名排序的
`files` JSON 映射的 SHA-256，覆盖文件集合与逐文件哈希。Go 步骤包含同目录 helper。
清单本身与可选的 `README.md`
不参与文件哈希；未知文件、符号链接、额外目录、重复 YAML key、未知字段、多文档 YAML、
版本不符、文件增删或内容漂移均拒绝。迁移器同时验证已捕获的 SQL/Go 内容与清单，
然后再连接数据库；正常运行绝不生成或更新清单。

```bash
just migrate-checksums canvas v1.0.1  # 显式生成指定版本，供审查与提交
just migrate-check                   # 离线检查全仓迁移清单，不连接数据库
```

同一发布开发时新增 `v1.0.1.1.up.sql` / `v1.0.1.1.down.sql` 等步骤文件，
写入 UP/DOWN 后重新生成该发布清单；不创建数字步骤子目录。
生成命令只能追加步骤或更新尚未执行的步骤，不能改写已执行步骤；已执行后的修复必须追加新步骤。
`just lint` 和 tooling CI 都执行只读校验。数据库 `migration_sources` / history / audit
继续独立核对已执行内容，所以同时改 SQL 和清单也不能绕过数据库不可变历史。
首次导入清单不改 SQL 字节，也不改历史 checksum。

此设计参考 multix-app 的逐版本清单与执行记录双重校验。本仓库采用四段步骤 ID；每个发布的步骤从 0 连续递增，清单按数字顺序列出。
追加新步骤只扩充清单，不能改写已执行步骤；不引入兼容 checksum 白名单。
本清单不包含 `schemaChecksum`：multix-app 的该字段依赖 `schema.json` 及规范化数据库
结构比对。当前尚无这套结构快照能力，文件校验不证明数据库未被手工修改。

## 开发与发布

```bash
just migrate-up canvas           # 只升级 Canvas，保留所有业务数据
just migrate-up canvas v1.0.1    # 升级到该发布清单的最后一步
just migrate-up canvas v1.0.1.0  # 精确升级到某一步；UP 不允许降级
just dev
```

发布变更应说明源版本、目标版本、涉及表、数据转换、旧应用兼容范围和失败恢复方法。
先在隔离数据库恢复代表性旧数据，运行升级、重复执行、失败回滚及业务读写验证。
本次 Canvas `v1.0.1/v1.0.1.0.up.sql` 仅新增事件 checkpoint/日志表和索引，保留项目、画布、节点、
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

**显式降级使用 `just migrate-down <service> <target>`，不自动恢复数据。** 把低版本传给 `migrate-up`
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
自身的版本要求。K8s 回退应用 Deployment 时同样保留兼容的迁移 Job，不自动执行
DOWN。本次 Canvas 的新增表可保留供旧代码忽略，回退不需要删事件表。

## 每次变更的 UP / DOWN 审查要求

UP 文件位于 `migrations/<release>/<release>.<step>.up.sql`，已应用文件不可修改。
该版本的逆操作位于 `migrations/<release>/<release>.<step>.down.sql`；缺失表示不可自动降级。
三段目标选择该发布目录当前清单的最后一步，四段目标精确指定步骤。
发布内回退必须指定四段目标，例如 `just migrate-down canvas v1.0.1.0`。
DOWN 必须指定目标，按反序撤销高于目标的步骤，不能撤销 `v1.0.0.0` 初始基线。
同目标重跑无操作；错误方向、缺失脚本、checksum 漂移均拒绝。
所有待执行逆操作、当前版本与活动历史在同一锁和事务内提交，失败全部回滚。
`migration_history` 表示当前已应用版本；`migration_audit` 追加保存执行过的 UP/DOWN
及 checksum，降级后再次升级仍检查此前执行的 SQL。`migration_sources` 在 UP 提交时
同时锁定该步骤 UP 与 DOWN 的 checksum（缺失 DOWN 也记录），首次 DOWN 前的修改同样拒绝。
旧库先验证已有 history/audit，再一次性补录来源；从未记录过的 DOWN 无法追溯历史内容，
首次接入须审查，之后不可改写。旧库首次运行自动补录活动历史。
DOWN 不创建数据库、不修改角色凭据；必须在已存在的服务库上执行。

Canvas 本次升级的演练入口（隔离库或已停写且确认空事件表的环境）：

```bash
just migrate-up canvas v1.0.1
just migrate-down canvas v1.0.0
just migrate-up canvas v1.0.1
```

Canvas 逆操作获取两张事件表的排他锁并检查是否有行；只在均为空时删除表和索引。
任何事件或 checkpoint 存在都会拒绝，项目、画布、节点及事件数据全部保留。
不要为通过检查而删除数据。已有事件时优先保留 schema 回退应用，或新增向前修复。
停写期间禁止新应用重启；完成降级后只能启动兼容目标 schema 的应用。

部署镜像打包完整 `migrations/`，正常部署始终 UP；DOWN 是单独的维护操作。
在具有服务凭据的迁移容器内使用 `DB_MIGRATE_TRANSPORT=tcp`、`DATABASE_USER`、
`DATABASE_PASSWORD` 与 `POSTGRES_HOST`/`POSTGRES_PORT`，执行：
`bash /db-migrate.sh /schema/canvas v1.0.0 down`。
VPS/K8s 必须先停写并使用包含逆操作与所有已执行 SQL 的镜像，不把 DOWN 接入自动发布。

- UP：记录起止版本、受影响表和消费者、数据转换及兼容窗口；评估 DDL 锁、
  表重写、数据量与执行时间，在代表性旧数据上验证，不能只验证空库建表。
- DOWN：明确标注“可逆”或“不可逆”，给出前置条件、应用版本、停写要求、
  数据损失边界及恢复步骤。新增表在上线后可能已有数据，不能默认直接 DROP。
- 可逆变更：在隔离库演练 UP → 该变更专用的逆操作 → UP，校验数据与业务行为；
  正式执行遵循上面的向前修复/恢复流程，不手工删除迁移历史或伪造版本。
- 不可逆变更：不得生成空 DOWN 或宣称可回滚；采用向前修复，或经过演练的备份恢复，
  明确备份后的写入如何保留或对账。
- 每次迁移至少验证空库安装、旧库升级、重复执行、故障回滚，以及部署期间的新旧
  应用兼容性。恢复测试与升级测试分别报告，未演练的恢复路径不得标记为已验证。

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


数据库 DDL 风险还参考 [OpenAI PostgreSQL 扩展实践](https://openai.com/index/scaling-postgresql/)：
评估 schema 变更带来的锁和表重写，优先采用可控的小步骤。本项目将其落实为上述
UP 风险审查及分阶段转换要求。Anthropic 的文章讨论代码迁移的等价性验证，
并非数据库 UP/DOWN 标准；上述 DOWN 分类与演练规则是本项目的工程约束，
不声称两家公司提供或背书本仓库的降级执行器。
