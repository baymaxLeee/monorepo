# IAM

IAM 是 Go 身份服务，拥有账号、凭据、tenant/workspace、成员关系、角色、
refresh token、会话与用户偏好；Gateway 负责公共请求验证，业务服务负责资源授权。

认证端点在服务根路径挂载 login/register/refresh/logout/me，经 Gateway 的
`/api/iam-server/*` 公开。tenant/workspace、成员申请/审批、角色分配与活跃 workspace
切换也由 IAM 提供。完整路由以
[router](../../apps/backend/services/iam/internal/api/http/router/router.go) 为准。

Gateway 清除客户端伪造身份头，向下游传递已验证的 tenant、user、workspace 和
roles；不能把 user ID 或任意业务参数作为完整授权。workspace 切换更新会话范围，
服务访问仍需按资源 scope 检查。

[身份与配置决策](../ADR/identity-and-configuration.md)说明 IAM 与 Admin 的
分工；[IAM AGENTS](../../apps/backend/services/iam/AGENTS.md)提供实现入口。
验证：`just test backend/iam`、`just build iam`，涉及 claims/认证时同时验证 Gateway。
