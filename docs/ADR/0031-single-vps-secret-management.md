# ADR-0031: 单机 VPS 密钥管理——生成型内部密钥 + SOPS 运维密钥

## Status

Accepted — 2026-07-06

## Context

`infra/single-vps` 用一个 `docker-compose.prod.yml` 在单台 VPS 上跑全栈。此前所有
配置（含全部密码）由人手工写进一个 GitHub secret `VPS_ENV_FILE`（一整份 `.env`
文本），CI 在部署时重建成 `.env` 下发，并用一份 `required_keys` 白名单校验完整性
（`.github/workflows/deploy-single-vps.yml` 与 `infra/single-vps/deploy.sh` 各一份）。

这套设计有系统性的可维护性问题：

- **漂移即断**：ADR-0029 把共享库凭据拆成每服务独立 role（`iam`/`admin`/`chat`/
  `executor`/`knowledge`/`telemetry` + `workflow` 超级用户），新增 6 个
  `*_POSTGRES_PASSWORD`。代码里 compose 一加 `${KEY:?}`，`VPS_ENV_FILE` 就缺 key，
  CI 硬失败——这正是本 ADR 的触发场景。
- **分类错误**：把"机器内部、人永远不该看、可随时重生成"的密钥（Postgres 密码、
  `INTERNAL_API_TOKEN`）和"必须人来定/必须永久稳定"的密钥（super-admin 登录、
  第三方搜索 `EXA_API_KEY` / `TAVILY_API_KEY`、`ACCESS_TOKEN_SECRET`、Fernet
  `ADMIN_SECRET_KEY`）用同一种最笨的方式管理。
- **不可 review / 校验白名单重复**：blob 不可 diff；`required_keys` 在两处重复、易
  与 compose 契约脱节。

## 业界实践（依据）

- **Coolify** `SERVICE_PASSWORD_*` magic 变量：内部密码首次部署自动生成、持久化跨
  重部署、服务间共享。**Supabase 自托管** `generate-keys.sh` 自动生成全部内部密钥；
  **Dokploy** DB 密码 provisioning 时自动生成。→ 内部密钥应"生成 + 持久化"，不进人手。
- **SOPS + age**（2026 GitOps 主流）：必须人管的密钥加密后提交进 git，**私钥只在消费
  它的机器上**，在该机器解密，CI 不碰明文；可 diff、可 review、无漂移。
- Docker 官方推荐 `secrets:` + `_FILE` 让密码不进 `docker inspect`（本 ADR 记为
  follow-up，需改各服务代码，不在本次范围）。

## Decision

VPS 成为"生成型密钥的 source of truth"，compose 的 `.env` **在 VPS 上按三段拼装**
（`infra/single-vps/render-env.sh`）：

1. **运行时变量**（`IMAGE_REGISTRY` / `IMAGE_TAG` / `PUBLIC_PORT`）——由
   `deploy.sh` / CI 通过环境变量传入。
2. **机器内部密钥**（7 个 Postgres 密码 + `INTERNAL_API_TOKEN`）——VPS 上
   `openssl rand -hex 24` **生成一次并持久化**到 `${DEPLOY_DIR}/.env.secrets`
   （0600，永不进 git/CI），后续部署缺失才补、否则复用。
3. **运维/外部密钥**（super-admin 登录、`EXA_API_KEY` / `TAVILY_API_KEY`、
   `ACCESS_TOKEN_SECRET`、`ADMIN_SECRET_KEY`）——SOPS+age 加密为
   `infra/single-vps/secrets.sops.env` **提交进 git**，**只在 VPS 上**用本机
   age 私钥解密。

### 不可变约束

1. **内部密钥持久化是正确性要求，不是整洁**：`WORKFLOW_POSTGRES_PASSWORD` 兼作
   Postgres 超级用户口令，仅在数据卷首次初始化时写入；`ADMIN_SECRET_KEY`（Fernet）
   一旦有数据就不可轮换。因此二者必须稳定 → 内部密钥生成后固化在 `.env.secrets`，
   必须稳定的加密类密钥放进 SOPS（随 git 备份、可跨 VPS 重建恢复）。
   **`.env.secrets` 整体丢失时 fail-closed**：`render-env.sh` 检测到 postgres 数据卷
   已存在但 `.env.secrets` 不在，则拒绝重新生成并要求从备份恢复或 `down -v` 重来
   （否则新密码无法登录已有库、db-init 也修不回来）；仅缺个别 key（新服务）才补。
2. **age 私钥：VPS + 离线 recovery 双 recipient**：`bootstrap.sh` 在 VPS 上生成
   `age.key`（0600）并打印公钥。`.sops.yaml` 同时登记 VPS 公钥与一把离线保管的
   recovery 公钥（SOPS 原生多 recipient），这样 VPS 丢失也能重建解密、
   `ADMIN_SECRET_KEY` 等稳定密钥可恢复。CI 与仓库都不持有任何私钥。
3. **CI 不接触任何应用密钥**：删除 `VPS_ENV_FILE` secret 及 CI 的 "Stage .env" /
   "Verify completeness" 两步。CI 只需 SSH 凭据。
4. **删除 `required_keys` 白名单**：完整性由 VPS 侧"生成 + 解密"保证，最终由远端
   `docker compose config --quiet` 兜底校验插值，不再维护易漂移的白名单。
5. **保留 ADR-0029 的每服务 role 隔离**：改的是"谁产生密码"（机器，非人），隔离边
   界不变。

## Consequences

- 运维手工维护的密钥从 13+ 降到约 5 个（且集中在一个可 diff 的加密文件里）。
- 本 ADR 触发的失败类被根除：新增服务只需在 `render-env.sh` 的 `INTERNAL_KEYS` 加
  一行（自动生成），不再有 GitHub secret 漂移。
- SOPS 文件随仓库版本化，可 code review、可跨 VPS 重建恢复；VPS 重装只需重放
  `age.key`（或换新 key 后 `sops updatekeys` 重加密）。
- 代价：VPS 需装 `sops`+`age`（`bootstrap.sh` 自动完成）；首次需一次性建 `.sops.yaml`
  + 加密 `secrets.sops.env`。

## 边界 / Follow-up

- Docker Compose `secrets:` + `_FILE`（密码不进 `docker inspect`/env/日志）需改各服务
  读 `*_FILE`，记为独立 follow-up。
- `k8s` 路径不受影响（其密钥经 `Secret`/ExternalSecrets 注入，见 `infra/AGENTS.md`）。

## 回退

demo 阶段数据可重建。如需回退到旧 blob 模式：恢复 `VPS_ENV_FILE` secret 与 CI 两步、
还原 `deploy.sh` 的 `required_keys`。不建议——旧模式正是本 ADR 要消除的问题源。
