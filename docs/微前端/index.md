# 微前端

## 架构

Module Federation 2.0 + Rspack，配合 React Router data router。platform 是
唯一浏览器入口和唯一 `RouterProvider`，按需加载多个 mfe-\* remote。

```
shell (host @ :3000)
  ├── discovers ./routes → mfe_admin (remote assets @ :3001)
  └── discovers ./routes → mfe_chat  (remote assets @ :3005)
```

## 现有模块

| 模块      | 端口 | 路由                                                  | 后端          |
| --------- | ---- | ----------------------------------------------------- | ------------- |
| platform  | 3000 | `/`、`/login`、`/platform/*`                          | n/a           |
| mfe_admin | 3001 | 仅提供 `mf-manifest.json` / `remoteEntry.js` / chunks | admin service |
| mfe_chat  | 3005 | 仅提供 `mf-manifest.json` / `remoteEntry.js` / chunks | chat service  |

用户入口只有 platform。`mfe_*` 可以独立部署、独立启动 dev server，但 remote
root URL 不是业务入口，也不提供状态页；本地与生产都通过 platform 路由渲染业务页面。

## 通用规则

参见 `apps/frontend/AGENTS.md`。核心约束:

- MFE 之间禁止互相 import(走 `@packages/runtime` 事件总线)
- API 调用必须走 `@packages/api-client/<svc>`(自动生成的类型化客户端)
- platform 提供共享单例: react / react-dom / react-router-dom / zustand /
  @packages/runtime / @packages/auth-client / @packages/shared /
  @packages/components
- remote 使用 `import: false` 消费共享依赖，不打包 React、Router、平台基础包或共享 UI kit 的 fallback
- 跨 MFE 状态原语放在 `@packages/runtime`；Zustand 版本由 runtime 包依赖锁定，不在子应用重复声明
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

应用注册中心是远程元数据的唯一真源；新增 app 不需要修改 platform 的
静态 import、类型声明或 Rspack remotes 配置。

## 添加新 MFE

参见 `.agents/playbooks/new-mfe.md`。
