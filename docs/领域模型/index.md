# 业务资源与所有权

这里维护当前归属，不要求每个模型拆成一个服务。
服务注册、binding 与数据库清单以 [services.yaml](../../services.yaml) 为准。

| 资源 / 能力 | 所有者 | 消费边界 |
|---|---|---|
| 账号、凭据、tenant/workspace、成员与角色、会话、refresh token、用户偏好 | iam | Gateway 认证与服务身份查询 |
| 应用注册、bot、provider、skill、套餐与运营配置 | admin | 消费服务读取/缓存，不复制管理表 |
| 会话、消息、agent run、tool trace、运行时上下文 | chat | 原生 AI SDK 消息与流 |
| 项目、画布、节点、素材业务记录、生成任务与用量 | canvas | 引用 Asset；耐久工作交给 Executor |
| 语义文档、虚拟文件树、change set、解析索引与检索 | knowledge | 语义归 Knowledge，物理 bytes 归 Asset |
| 耐久 task、workflow、视频制片审批与执行投影 | executor | 任务契约与持久工作流 |
| Asset、Revision、Blob、Claim、上传与 delivery、物理回收 | asset | asset/revision ID 与 Claim intent |
| RUM、遥测接收与查询 | telemetry | 可观测契约 |
| 资源授权与业务审计 | 各资源所属服务 | Gateway 认证不能替代资源授权 |

跨服务通过 [schemas](../../schemas/AGENTS.md) 声明的契约。
字段、状态转换和授权不变量由服务内实现、schema 与行为测试共同验证；
本表不建立另一套领域模型。
