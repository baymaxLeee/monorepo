# ADR-0034: 前端统一 axios 单例 + response 拦截器兜底错误提示

## Status

Accepted — 2026-07-07

## Context

前端所有 REST 调用最终都收敛在 `packages/api`，但错误提示是**散落**的：登录、注册、
各 CRUD 页面各自在 `catch` 里写 `toast.error(String(e))` / `err instanceof Error ?
err.message : ...`，而 `packages/api/src/http.ts` 的 axios 单例只做了 401
refresh-retry，**不负责把后端错误 toast 出来**。这带来几个系统性问题：

- **不一致**：有的调用点提示、有的静默；文案格式（`String(e)` vs `e.message`）各页不同；
  后端 RFC7807 的 `detail` 常被 `String(e)` 拍成 `[object Object]` / `AxiosError: ...`。
- **登录接口漏拦截**：这正是本次触发场景——登录失败没有走任何统一提示层。
- **重复代码**：20+ 个页面重复同一段 try/catch + toast 模板。
- **React Compiler v1 miscompile**：async `try/catch` 里内联
  `err instanceof Error ? err.message : ...`，编译后 `catch` 绑定被丢弃，运行时崩溃。

要求（用户明确）：**除 SSE / raw-fetch 外，其余接口都走同一个 axios 单例，单例内
封装统一的 req/res 拦截器，res 拦截器统一做通用错误处理并提示后端错误信息。**

## 业界实践（依据）

- **单 axios 实例 + interceptors** 是社区默认形态（axios 官方 README、大量脚手架）：
  request 拦截器挂鉴权头，response 拦截器集中处理 401 刷新 + 全局错误提示，业务层只管
  happy path。
- **RFC7807 problem+json**：后端错误体优先取 `detail`，回退 `message`/`title`。
- **流式/SSE 无法过 axios 拦截器**：AI SDK `DefaultChatTransport`、`EventSource`、
  `fetch` 流式响应都不经 axios，需要一条**镜像同一套 401 策略**的 `fetch` 封装。

## Decision

### 1. 单例 + 拦截器兜底 toast（`packages/api/src/http.ts`）

- `apiHttp = axios.create({ baseURL, withCredentials })` 是**唯一** REST 实例；
  所有 typed wrapper 与 orval 生成客户端都经它。
- request 拦截器注入 `Authorization: Bearer <token>`。
- response 拦截器：
  1. 401 且非 auth 端点（`NO_REFRESH_PATHS`）且未重试过 → 单飞 refresh 后重放一次；
  2. 统一 `toApiError(error)` → `ApiError`（保留 `status`/`code`，message 已从
     RFC7807 body 解包）；
  3. **默认 `toast.error(apiError.message)`**，再 `throw apiError`。

### 2. `skipErrorNotify` 逐请求关闭全局 toast

`ApiRequestConfig extends AxiosRequestConfig { skipErrorNotify?: boolean }`。两类请求
携带它以避免"拦截器 + 页面"双重提示：

- **后台探针**：token refresh、account-availability（本就该静默）。
- **自渲染内联错误的读操作**：list/detail 页失败时渲染整页 "请求失败" Alert
  （`fetchBots`/`listOrgMembers`/`fetchTelemetry*` 等），toast 会重复，故由对应调用点传
  `skipErrorNotify: true`，页面用 `getErrorMessage(e)` 填充内联文案。共享 read wrapper
  默认仍保留全局 toast，避免复用到无内联错误 UI 的组件时失败完全静默。

### 3. SSE / 流式：`authFetch`（`auth-fetch.ts`）

AI SDK transport、blob 源和少量 multipart/raw fetch 改用 `authFetch`——镜像同一套 401
refresh-ahead + retry-once 策略，但不经 axios。这些调用点**保留**自身
`toast.error(getErrorMessage(err))`，因为拦截器看不到它们。

### 4. `getErrorMessage`（`packages/shared`）

纯模块级函数，统一从 `Error`/string/unknown 提取展示文案（带 fallback）。放在组件体外
同时规避了 React Compiler v1 对 `catch` 内联三元的 miscompile。

## Consequences

- 登录/注册/CRUD 的 `catch` 收敛为空块或只做 `finally` 清理；错误提示由拦截器
  唯一负责，文案统一走 RFC7807 解包。
- 新增接口默认即有兜底提示；只有"自渲染错误"或"后台探针"的调用点才需显式
  `skipErrorNotify`。
- 代价：`packages/api` 直接依赖 `sonner`（`toast`），拦截器与 UI toast 产生一处耦合——
  可接受，因为提示是 API 层的既定职责，且 `sonner` 已是 MF 场景下的既有依赖。
- 边界仍清晰：SSE 是唯一"绕过 axios"的通道，且用 `authFetch` 复用同一 401 策略，不产生
  第二套鉴权逻辑。
