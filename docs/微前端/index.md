# 微前端

## 架构

Module Federation 2.0 + Rspack。一个 shell host 加载多个 mfe-* remote。

```
shell (host @ :3000)
  └── loads → mfe-bot (remote @ :3001)
```

## 现有模块

| 模块 | 端口 | 路由 | 后端 |
|---|---|---|---|
| shell | 3000 | `/`、`/login` (host) | n/a |
| mfe_admin | 3001 | `/platform/admin/*` | admin service |

## 通用规则

参见 `apps/frontend/AGENTS.md`。核心约束:
- MFE 之间禁止互相 import(走 `@packages/runtime` 事件总线)
- API 调用必须走 `@packages/api-client/<svc>`(自动生成的类型化客户端)
- 共享单例: react / react-dom / @packages/runtime / @packages/auth-client / @packages/shared
- UI: `@packages/components` 各 MFE 按需打包；Tailwind 仅 platform 构建全局 CSS

## 添加新 MFE

参见 `.agents/playbooks/new-mfe.md`。
