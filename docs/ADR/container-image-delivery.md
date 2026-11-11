# 容器镜像的增量构建与原子发布

状态：当前。适用于 GHCR、可选国内镜像仓库和 Single-VPS 自动部署。

## 决策与事实源

一次提交仍发布一个可回滚的 `sha-<commit>` 原子 release，但不再重建所有镜像。
[image-plan.mjs](../../scripts/image-plan.mjs) 是镜像清单、build context 和源码影响关系的
事实源；[build-images](../../.github/workflows/build-images.yml) 只消费其动态 matrix。

- 受影响组件执行独立 Docker build，并发布 GHCR `sha-*` 与 `main` tag。
- 未变化组件从该组件已有的 `main` digest 创建本次 `sha-*` tag，不上传 layer。
- 发布门禁逐个确认全部组件都有本次 immutable tag；缺少旧镜像、未知变更范围或不可靠
  diff 必须失败或保守全量构建，不能产生不完整 release。
- 手动发布与版本 tag 强制全量构建。普通 main push 从最近一次成功的 `build-images`
  release SHA 比较到当前 HEAD，而不是只比较相邻 commit；因此中间失败或取消的 run 所包含的
  变化不会漏构建。成功基线查询失败时全量构建。部署配置本身变化可以 0 build、全量 digest
  复用，从而仍能发布并部署新的运维配置。

影响关系按真实 Docker `COPY`/build input 维护，不按服务 HTTP binding 扩散。共享库只扩散到
其镜像消费者；migration 同时影响所属服务镜像和聚合 `db-init`；frontend workspace 聚合到
`web`。新增镜像或改变 Docker input 时必须同步选择器测试，未知可执行路径采用全量 fallback。

## 发布和部署生命周期

`build-images` 先通过 backend、frontend、tooling 与 contract gates，再并行 build/reuse，最终
验证 GHCR 原子 release。它保存包含精确 commit、tag、build/reuse 集合的 `image-plan` artifact。

[mirror-images](../../.github/workflows/mirror-images.yml) 只在 GHCR release 成功后运行。变更镜像
从 GHCR 复制到运营配置的 OCI registry；未变化镜像在目标 registry 内 manifest retag。国内
registry 的带宽和限流因此不阻塞 GHCR 构建，但仍是使用该 registry 自动部署前的强制门禁。
现有 `TCR_*` 变量是运营 registry 的外部配置接口，host 可以是 TCR 或其他兼容 registry。

[deploy-single-vps](../../.github/workflows/deploy-single-vps.yml) 从 mirror workflow artifact 读取原始
commit 和 image tag，不使用可能已经前移的默认分支 HEAD。Compose 继续消费一个 `IMAGE_TAG`；
组件级打包不会牺牲整套部署的原子 tag、审计或回滚。镜像仓库故障时可用同一 `sha-*` 切换回
GHCR；mirror 或任一组件发布失败时不触发自动部署。

这条链只有 `build-images -> mirror-images -> deploy-single-vps` 三层，保持在 GitHub
`workflow_run` 的链式触发限制内。

## 镜像层边界

Python 服务只复制实际依赖的 `libs/kernel`，依赖安装先于业务源码，并在 runtime 中将稳定
`.venv` 与易变源码分层复制。普通源码或无关共享库变化不得重新生成并上传完整虚拟环境 layer。
是否缩减 `markitdown` 等业务依赖由服务能力决定，不能为 CI 速度静默删除格式支持。

## 取舍与依据

采用 manifest retag，而不是立刻把 Compose 改为每服务 tag：后者会把 release manifest、环境
渲染、回滚和人工操作一起复杂化；当前方案已经得到组件级构建收益，同时保留单 tag 原子部署。
如果未来多个服务独立发布频率、审批或回滚责任真正分离，再把 release artifact 提升为每组件
digest manifest，而不是在 Compose 中使用可变 `main`。

GitHub Actions 支持使用 job output 和 `fromJSON` 生成动态 matrix；Docker Buildx
`imagetools create` 支持从已有 manifest 创建新 tag 和跨 registry 复制。平台能力只提供机制，
本仓库的保守 fallback、原子 release 与部署门禁由上述实现和测试拥有：

- [GitHub Actions：用 output 定义 matrix](https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs#using-an-output-to-define-two-matrices)
- [Docker：imagetools create](https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/)
- [Docker：在 registry 之间复制镜像](https://docs.docker.com/build/ci/github-actions/copy-image-registries/)

验证边界包括 `scripts/image-plan.test.mjs` 的选择/fallback 行为、workflow 静态校验、三个 Python
镜像的真实 build，以及仓库 tooling、链接和 Single-VPS 配置检查。真实 registry 复制速度与
凭据只能由 main 上的受信 CI run 验证。
