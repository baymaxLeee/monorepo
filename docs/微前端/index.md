# 微前端

## 架构

Module Federation 2.0 + Rspack，配合 React Router data router。platform 是
唯一浏览器入口和唯一 `RouterProvider`，按需加载多个 mfe-\* remote。

```
platform (host @ :3000)
  ├── loads → admin (remote @ :3001)  routes: /platform/admin/*
  └── loads → chat  (remote @ :3005)  routes: /platform/chat/*
```

Capability packages（next-forge 风格，非业务服务模板）：
`@repo/design-system` / `@repo/ai-elements` / `@repo/editors` / `@repo/viewers` /
`@repo/api` / `@repo/runtime` / `@repo/build-config`。拆包基线见
`docs/baselines/`。

## 现有模块

| 模块      | 端口 | 路由                                                  | 后端          |
| --------- | ---- | ----------------------------------------------------- | ------------- |
| platform  | 3000 | `/`、`/login`、`/platform/*`                          | n/a           |
| admin     | 3001 | 仅提供 `mf-manifest.json` / `remoteEntry.js` / chunks | admin service |
| chat      | 3005 | 仅提供 `mf-manifest.json` / `remoteEntry.js` / chunks | chat service  |

用户入口只有 platform。remote app 可以独立部署、独立启动 dev server，但 remote
root URL 不是业务入口，也不提供状态页；本地与生产都通过 platform 路由渲染业务页面。

## 通用规则

参见 `apps/frontend/AGENTS.md`。核心约束:

- MFE 之间禁止互相 import(走 `@repo/runtime` 事件总线)。该约束由 `turbo boundaries`
  的 `app` tag 规则强制执行（`dependents.allow: []`），不只是文档约定
- API 调用必须走 `@repo/api`(自动生成的类型化客户端从包入口统一导出)
- platform 提供共享单例: react / react-dom / react-router-dom / zustand /
  @tanstack/react-query / sonner / @repo/runtime / @repo/shared / @repo/observability
- UI 包(`@repo/design-system` / `ai-elements` / `editors` / `viewers`)**不进 MF shared**,
  保持普通 workspace 依赖,让每个 app 按需 tree-shake
- remote 使用 `import: false` 消费共享依赖，不打包 React、Router 或平台基础包的 fallback
- 跨 MFE 状态原语放在 `@repo/runtime`；Zustand 版本由 runtime 包依赖锁定，不在子应用重复声明
- 子应用私有 store 可以存在于各自 `src/store/`，`create` / `useShallow` 直接从 `zustand` 包导入；MF shared 保证运行时仍消费 host 提供的同一份库
- remote 产物保留业务代码、服务 API client、业务直接依赖以及 federation entry/chunks
- Tailwind 仅 platform 构建全局 CSS；remote 不导入 CSS、不注册 PostCSS

## 路由契约

应用注册中心保存 `base_path`、`remote_name`、`expose_key` 和 manifest
`entry`。remote 统一暴露 `./routes`：

```ts
import type { RouteObject } from "react-router-dom";

export const routes: RouteObject[] = [
  {
    id: "reports-root",
    lazy: () => import("../pages/layout"),
    children: [{ index: true, lazy: () => import("../pages/home") }],
  },
];
```

页面入口遵循 React Router `route.lazy` 模块约定，命名导出 `Component`。
remote 的路径必须相对 `base_path`，不得创建自己的 router、调用
`useRoutes`，也不得依赖 platform 的业务路由实现。

platform 使用 `patchRoutesOnNavigation` 在首次访问 app 路径时加载远程
route module，并将其挂载到 `/platform` 路由树。这样直接访问、浏览器前进
后退和客户端跳转共享同一套路由状态、loader、pending UI 与错误边界。
platform 的静态父路由 middleware 负责认证重定向；动态路由发现只在会话有效后
访问应用注册中心，未登录的深链不会先触发受保护的 registry 请求。
认证、组织准入和 app 可用性策略集中在 platform router，remote 页面不得
自行实现登录态首屏重定向。

应用注册表拓扑、remote 注册和已经 patch 的路由按页面生命周期缓存。子路由导航、
session 或 active org 变化都不得清除拓扑缓存或重新注册 remote；route middleware
使用当前 session 判断已发现 app 的访问权限。新增 app、可见性扩大和路由配置变更
在刷新页面后生效。page-view 采集由无 UI 的 location observer 完成，不让
platform Layout 订阅子应用路由状态。

应用注册中心是远程元数据的唯一真源；新增 app 不需要修改 platform 的
静态 import、类型声明或 Rspack remotes 配置。

## 添加新 MFE

参见 `.agents/playbooks/new-mfe.md`。
