# 部署入口

| 部署目标 | 操作入口 |
|---|---|
| 单机 Docker Compose | [Single-VPS 部署、升级与恢复](../../infra/single-vps/README.md) |
| Kubernetes 生产环境 | [生产 overlay 的前置配置与发布](../../infra/k8s/overlays/prod/README.md) |
| 单独构建静态前端 | [静态构建脚本与托管参数](../../scripts/build-frontend-static.sh) |
| 确认某个提交的镜像是否已发布或镜像同步失败 | [镜像交付与验证](../ADR/container-image-delivery.md) |
