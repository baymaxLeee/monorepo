# 当前决策：微前端与 AI 界面

状态：当前。React + Rspack + Module Federation，按真实 workspace 包名消费能力。

Platform 是唯一用户入口、RouterProvider 和身份/应用准入边界。Remotes 暴露
相对 `RouteObject[]`，页面 lazy module 导出 Component，不另建 Router。
Admin 应用注册中心提供 base path、remote name、expose key 和 manifest entry；
Platform 按导航发现/挂载路由，不静态导入 remote 业务代码。

认证和 workspace/app 策略在 host router 执行，可见页面外壳由各 remote 自己
拥有。拓扑按页面生命周期缓存；scope 切换重新判断访问权，不重复注册 remote。
新增应用和可见性扩大在刷新后生效。

## 包与运行时

`app`、`feature`、`ui`、`data`、`runtime`、`util` 的允许依赖由
[turbo.json](../../apps/frontend/turbo.json) 管理，每包声明标签；应用无源码
消费者。共享包使用 package exports，不从另包的 src 深入导入。

Host 提供 React、Router 与需要跨 MFE 身份一致的运行时单例；remote 不打包这些
依赖的 fallback。UI/API 能力包保持普通 workspace 依赖，按需 tree-shake。
重型编辑器/预览/终端通过子路径懒加载。共享清单以
[mf-shared](../../apps/frontend/packages/build-config/mf-shared.mjs) 为准。

普通 API 经 `@repo/api` 的 axios 单例执行认证、refresh/retry 和错误通知；流式
请求经 authFetch。业务层不重复全局错误 toast。UI primitives 不反向依赖 API
或 runtime，业务 orchestration 放 feature/app。

## 设计与 AI UI

[DESIGN.md](../../DESIGN.md) 是唯一完整 UI 规范。Base UI/shadcn 原语、theme 和
Tailwind 全局 CSS 由 design-system/host 负责；不混入第二套 primitive。remote
可在 lazy 入口加载组件自己的第三方 CSS，但不另建 Tailwind 全局构建。

Overlay 层级按 React 所有权和 portal-layer 管理，不维护业务 z-index 表。
AI UI 消费原生消息/工具/审批/来源/文件部分，依据 metadata 选择展示，不靠
工具名称硬编码另一套协议。AI Elements 保持源码组合和重型子路径边界。

## 取舍与验证

独立 remote 构建/部署带来 host 单例和路由契约的协调成本；统一准入、依赖标签、
公共 API 与设计原语使 AI 能在有限上下文里确定修改位置。
React Compiler、原生 TypeScript checker 和依赖版本以已安装配置为准。

验证 `just test frontend/<package>`、UI contracts、typecheck、`turbo boundaries`
及受影响 Rspack build。单元测试不能证明 federation、CSS 或真实 overlay 交互。
