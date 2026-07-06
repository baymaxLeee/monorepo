# ADR-0030: iam 身份 bootstrap 从 server 启动路径移到部署时一次性 seed

## Status

Accepted — 2026-07-06

## Context

iam 需要预置两样系统身份:**super-admin** 与 **guest-org**。这不是静态 SQL 数据
——它跨 `users` / `user_credentials` / `roles` / `user_roles` / `organizations` /
`organization_members` 多表,含 bcrypt 密码哈希与幂等 upsert 领域规则
(`EnsureSystemBootstrap` → `internal/service/seed.go`)。因此它**只能由 iam 的 Go
代码 seed**,不能放进 `infra/single-vps/seed/*.sql`(那里只装 admin 那种纯配置行)。

改造前的实现有四处系统性问题:

1. **每副本 seed**:`EnsureSystemBootstrap` 在 `cmd/server` 启动路径里被调用,
   于是每个 server 副本一起来就 seed。k8s `replicas: 2` + 滚动更新会让多个副本
   **并发竞争同一 bootstrap 事务**。
2. **误导的 `cmd/migrate`**:另有一个独立 `cmd/migrate` binary 也只做
   `EnsureSystemBootstrap`,名字却叫 "migrate"。iam 的 schema 实际由 SQL 迁移
   (`scripts/db-migrate.sh`)建,`cmd/migrate` 完全不碰 schema;`store.AutoMigrate`
   是无人调用的死代码。
3. **k8s 迁移 Job 是坏的**:iam `Dockerfile` 只 build `cmd/server`,镜像里根本没有
   migrate binary;而 `deploy-prod.yml` 的 "iam-migrate" Job 跑
   `command:["/server"] args:["migrate"]` —— `cmd/server` 不解析子命令,会**起一个
   永不退出的 HTTP server**,`kubectl wait --for=complete` 必然超时。也就是说线上
   真正在 seed 的只有 server 启动路径,那个 Job 从未真正完成过。
4. **调用点四散**:`Procfile.dev` 跑 `cmd/server`(隐式 seed)、`db-bootstrap.sh` 与
   `reset-demo-dbs.sh` 跑 `cmd/migrate`、k8s 跑坏掉的 `/server migrate`。

## Decision

1. **seed 成为 `cmd/server` 的显式子命令 `server seed`**:执行
   `EnsureSystemBootstrap` 后退出;**server 主路径不再 seed**。单镜像单 binary 多
   子命令,契合 `deploy-prod.yml` 早已假设的 `/server <subcommand>` 形态,
   `Dockerfile` 零改动。
2. **删除误导的 `cmd/migrate`**,逻辑并入 `server seed`。
3. **部署编排在 schema 迁移之后、server 起来之前,一次性跑 seed**:
   - **single-vps**:新增 `iam-bootstrap` 一次性容器(`command:["seed"]`,
     `restart:"no"`),`depends_on db-init(completed)`;`iam` server 反过来
     `depends_on iam-bootstrap(completed)`。启动链:
     `postgres(healthy) → db-init → iam-bootstrap → iam server`。
   - **k8s**:`deploy-prod.yml` 的 Job 改跑 `/server seed`(**修复原坏 Job**),在
     rolling deployment 之前完成。
   - **本地**:`db-bootstrap.sh`(`just up`)与 `reset-demo-dbs.sh` 改跑
     `go run ./cmd/server seed`。
4. **super-admin / guest-org env 仍是 iam 服务级共享契约**:server 与 seed 走同一
   `config.Load()` + `validate()`。single-vps 用 `x-iam-env` YAML anchor 做单一来源,
   k8s 用同一 `iam-config` / `iam-secrets`。变的只是**写入动作**的时机(从 server 启动
   移到显式 seed),配置来源与 production 校验规则不变。

## Consequences

- server 副本启动不再 seed,N 副本不再并发竞争 bootstrap 事务。
- k8s 的 bootstrap 从"永不完成的坏 Job"变为真实可完成的一次性 seed。
- 四处调用点统一为 `/server seed`(容器)或 `go run ./cmd/server seed`(本地)。
- 幂等语义不变:重复部署重复跑 seed 安全(`EnsureSystemBootstrap` 幂等)。
- server 仍持有它不直接写入的 `SUPER_ADMIN_*` env —— 无害(与 seed 同一 secret),
  且让 production 校验对两个入口一致。

## 边界(本次不做)

- 不改 `config.validate` 去区分 server / seed 模式:server 在 production 仍校验
  `SUPER_ADMIN_*`,作为服务级契约防止 seed 与运行期配置漂移。
- iam 的 **schema 迁移在 k8s 仍是 out-of-band**(托管 PG + SQL 迁移,见
  `infra/k8s/overlays/prod/README.md`);本 ADR 只把**身份 seed** 正名并一次性化,
  不负责 k8s schema 迁移编排(独立 follow-up)。
- `store.AutoMigrate` 死代码清理留作独立事项。

## 回退

demo 阶段数据可重建。如需回到旧行为,把 `EnsureSystemBootstrap` 调回 `cmd/server`
主路径、移除 `iam-bootstrap` 容器 / Job 即可。
