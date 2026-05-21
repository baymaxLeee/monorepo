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
| shell | 3000 | / (host) | n/a |
| mfe-bot | 3001 | /bots/* | bot service |

## 通用规则

参见 `apps/frontend/AGENTS.md`。核心约束:
- MFE 之间禁止互相 import(走 `@app/runtime` 事件总线)
- API 调用必须走 `@app/api-client/<svc>`(自动生成的类型化客户端)
- 共享单例: react / react-dom / @app/runtime / @app/ui-kit

## 添加新 MFE

参见 `.agents/playbooks/new-mfe.md`。
