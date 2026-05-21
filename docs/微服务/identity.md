# identity 微服务

`identity` 是 Go 微服务，负责用户身份、登录态和用户基础偏好。

## 数据所有权

- `users`: 账号主表和常用个人配置字段，包括邮箱、展示名、头像、手机号、语言、时区、主题、营销订阅、邮箱验证状态、禁用状态、最近登录时间。
- `user_credentials`: 密码哈希、密码变更时间、失败次数和锁定时间。
- `refresh_tokens`: refresh token 哈希、过期时间、吊销时间、设备信息、IP、轮换链路。

## API

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/auth/me`

外部访问经由 `api-gateway` 的 `/v1/auth/*` 代理进入。
