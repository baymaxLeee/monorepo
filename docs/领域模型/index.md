# 业务资源与所有权

这里维护当前归属，不要求每个模型拆成一个服务。
服务注册、binding 与数据库清单以 [services.yaml](../../services.yaml) 为准。

| 资源 / 能力 | 所有者 | 消费边界 |
|---|---|---|
| 账号、凭据、tenant/workspace、成员与角色、会话、refresh token、用户偏好 | iam | Gateway 认证与服务身份查询 |
| 应用注册、provider、skill、套餐与运营配置 | admin | 消费服务读取/缓存，不复制管理表 |
| Web 产品会话、Runtime Session 映射、用户 Memory | [chat](../微服务/chat.md) | 校验产品 scope，解析本轮能力并代理执行请求 |
| 项目、画布、节点、素材业务记录、生成任务与用量 | canvas | 引用 Storage revision，由 Canvas worker 处理画布后台任务 |
| 语义文档、解析索引与检索 | knowledge | 文档语义归 Knowledge，物理 bytes 归 Storage |
| 云端 Session、消息、Turn、执行 journal、会话文件与 durable Job | [runtime](../微服务/runtime.md) | 消费宿主冻结的 capability，运行共享内核并持久化执行状态 |
| Asset、Revision、Blob、Claim、UploadSession、delivery 与物理回收 | storage | workload identity、asset/revision ID、Claim intent 与签名 Capability |
| RUM、遥测接收与查询 | telemetry | 可观测契约 |
| 资源授权与业务审计 | 各资源所属服务 | Gateway 认证不能替代资源授权 |

跨服务通过 [schemas](../../schemas/AGENTS.md) 声明的契约。
字段、状态转换和授权不变量由服务内实现、schema 与行为测试共同验证；
本表不建立另一套领域模型。
