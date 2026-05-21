# 微服务

## 现有服务

| 服务 | 语言 | 端口 | 说明 |
|---|---|---|---|
| api-gateway | Go | 8000 | BFF / 边缘网关 |
| admin | Python | 8001 | 智能体管理 |

## 通用规则

参见 `apps/backend/AGENTS.md`。核心约束:
- 服务自治: 各自的 DB、各自的部署、不互相 import
- 跨服务调用: 走 `libs/transport/` 客户端,不走直接 import
- 共享内核(`libs/`): 只放基础设施,**禁止**放领域模型

## 添加新服务

参见 `.agents/playbooks/new-microservice.md`。

## 服务间通信

- **同步**: gRPC(优先,定义在 `schemas/proto/`)或 REST(`schemas/openapi/`)
- **异步**: CloudEvents(`schemas/events/`)
