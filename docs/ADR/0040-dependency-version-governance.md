# ADR-0040: 多生态依赖版本治理

## Status

Accepted

## Context

本仓库同时维护两个独立的 pnpm workspace、一个 uv workspace 和多个 Go module。根目录
`package.json` 不是这些工作区的统一解析器；不同语言 SDK 的版本号也不具备跨生态可比性。

前端的 Module Federation runtime 依赖散落在多个包中，容易出现运行时 singleton 版本漂移。
Python 已有单一 `uv.lock`，Go 服务则必须保持可独立构建。

## Decision

- Node.js 统一固定为 `24.18.0` Active LTS：本地和项目外默认版本均由 mise 管理，
  pnpm 固定为 `11.9.0`；根、前端、后端 workspace 的 `engines` 与所有 Node
  容器基础镜像使用同一 Node 补丁版本。Codex CLI 使用官方 standalone 安装，避免
  npm 全局包随 Node 安装目录重复升级。
- 前端 pnpm workspace 使用 `catalog:` 管理共享的直接依赖；React、Router、Zustand、
  React Compiler runtime 与 AI SDK 同时通过 `overrides` 约束整个依赖图。
- 前后端 TypeScript 类型检查与编辑器使用原生 TypeScript 7；`typescript` 5.x 暂时
  保留给仍依赖旧编程 API 的 Module Federation、Nitro、Workflow plugin 等工具。
  原生编译器以 `@typescript/native` alias 在两个 pnpm workspace 独立登记，业务包的
  `build` / `lint` / `typecheck` 必须显式调用它，避免同名 `tsc` 二进制冲突。
- 后端 Node workspace 延续现有 pnpm catalog；前后端是独立 pnpm 解析边界，不共享 lockfile。
- Python 以根目录 `uv.lock` 作为所有 workspace member 的精确依赖事实来源；CI 使用
  `uv lock --check` 拒绝未提交的锁文件变更。
- 每个 Go 服务以 `GOWORK=off` 构建，并在 CI 中执行 `go mod tidy` 后检查 `go.mod` 和
  `go.sum` 无差异。`go.work` 仅用于本地多模块开发。
- Renovate 负责更新提案，按 React Module Federation、Vercel AI SDK 与各语言
  OpenTelemetry 依赖组创建升级 PR。

## Consequences

- Node 或 pnpm 升级必须同时更新 `mise.toml`、workspace `package.json`、Node
  Dockerfile 与本 ADR；`just doctor` 会拒绝实际 PATH 与 mise 项目版本不一致。
- `@types/node` 跟随 Node 主版本，Node 24 的开发、构建和容器运行时使用同一套 API 类型。
- 改动前端共享依赖的版本只需编辑 `apps/frontend/pnpm-workspace.yaml` 和锁文件。
- 新增共享前端依赖必须先登记 catalog；`catalogMode: strict` 会阻止绕过该入口的
  `pnpm add`。
- TypeScript 7 提供稳定编程 API、且 Module Federation 声明兼容后，删除旧
  `typescript` 依赖并让原生编译器恢复标准包名；过渡期不得让工具隐式选择 `tsc`。
- 普通业务 package 不直接声明旧 `typescript`；TS5 只能留在承载已确认旧 API / peer
  消费者的 package。所有含 TS 源码的 workspace package 都有独立 TS7 typecheck。
- 仅在已确认的安全修复或上游元数据问题时，才对 Python 使用 uv override，或对 pnpm
  使用额外 override；它们不是常规版本声明方式。
