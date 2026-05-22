# 微前端

## 架构

Module Federation 2.0 + Rspack。一个 shell host 加载多个 mfe-\* remote。

```
shell (host @ :3000)
  └── loads → mfe_admin (remote assets @ :3001)
```

## 现有模块

| 模块      | 端口 | 路由                                                  | 后端          |
| --------- | ---- | ----------------------------------------------------- | ------------- |
| platform  | 3000 | `/`、`/login`、`/platform/*`                          | n/a           |
| mfe_admin | 3001 | 仅提供 `mf-manifest.json` / `remoteEntry.js` / chunks | admin service |

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
- remote 产物保留业务代码、服务 API client、业务直接依赖以及 federation entry/chunks
- Tailwind 仅 platform 构建全局 CSS；remote 不导入 CSS、不注册 PostCSS

## 添加新 MFE

参见 `.agents/playbooks/new-mfe.md`。
