# 当前决策：数据、部署与观测

状态：当前。配置文件与部署脚本是运行事实源，本文件维护不可从枚举看出的约束。

## 数据与启动

业务服务各自拥有 PostgreSQL database/role，禁止使用 Workflow bootstrap 超级用户
运行应用。Knowledge 使用 pgvector；Workflow 使用独立 Postgres World，官方 setup
在 Executor 接流量前完成，业务库与执行库保持不同所有权。

本地与部署数据库都保存历史数据。schema 和小规模数据转换采用不可变、按版本排序的
SQL，保留逐版本 checksum，并在数据库锁下将待执行 SQL 与版本记录一起提交。
已有 `v1.0.0` 库经 checksum 验证后接入历史，不重建业务表。失败回滚，重复执行验证
后跳过，禁止静默修复历史或用 reset 代替升级。

应用回退优先保留兼容的新 schema；结构或数据撤销使用经过验证的向前修复或备份恢复，
不提供猜测可逆性的通用 DOWN。VPS 的迁移镜像可独立固定版本，避免回退应用时误用
旧迁移器。大规模回填由数据所属服务实现可重入批处理，不占用发布 DDL 长事务。
具体协议、恢复边界及验证入口见 [数据库迁移规范](../开发规范/database-migrations.md)。

## 部署与密钥

本地 Compose、Single-VPS 与 K8s 保持相同 service binding 和身份语义。
`livez` 表示进程存活，`readyz` 检查依赖，不能让数据库抖动触发 liveness 重启。
部署先做数据库与 World 初始化，再启动服务；正式发布使用通过验证的源码 SHA。

VPS 将运行参数、生成后持久保存的内部密钥、SOPS/age 管理的运维密钥组合成
运行环境。已有数据卷但持久密钥文件丢失时 fail closed，不能生成新密码冒充恢复。
Fernet/签名等稳定密钥的轮换需要明确恢复或重加密策略；CI 不输出应用明文密钥。
K8s 注入相应 Secret，保留同等身份和签名稳定性。

Asset bytes 使用单 writer 持久卷与应用数据库一致备份；卷权限、初始化和
非 root 运行要同时验证。不要把临时工作目录或模型 sandbox 当作 durable storage。

## 观测

原生日志库输出结构化 JSON；`X-Trace-Id` 用于日志关联，W3C traceparent 用于
跨服务 trace。各 runtime 已有 OTel 接入，Collector/ClickHouse 是观测基础设施。
产品自己的 agent run/step/tool 记录与平台 trace 不互相替代。

根 `just up` 启动包括 observability 的本地基础设施，`just up-core` 只启动核心
依赖。保留和内存策略以部署配置为准；不复制旧文档的 TTL/资源数字作为新规则。
不默认采集完整 prompt/response 或逐 token SSE 明细。

## 取舍与验证

共享 Postgres 实例降低运维成本，但数据库/role 和服务所有权仍隔离。事务化升级
保留数据并简化失败恢复，代价是不能直接执行非事务 DDL 或长时间回填；这些变化
需要专门的分阶段方案，不能借助修改基线绕过。

入口：[root justfile](../../justfile)、[db migrate](../../scripts/db-migrate.sh)、
[VPS](../../infra/single-vps/README.md)、[K8s](../../infra/k8s/overlays/prod/README.md)、
[logging contract](../../schemas/observability/logging.md)。
结构变化验证 install/up/dev/build/sync/lint 受影响路径及部署渲染；真正的恢复、
凭据、权限与 trace 链路需要集成证据，配置存在不代表运行成功。
