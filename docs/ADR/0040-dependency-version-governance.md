# ADR-0040: 多生态依赖版本治理

## Status

Accepted

## Context

本仓库同时维护两个独立的 pnpm workspace、一个 uv workspace 和多个 Go module。根目录
`package.json` 不是这些工作区的统一解析器；不同语言 SDK 的版本号也不具备跨生态可比性。

前端的 Module Federation runtime 依赖散落在多个包中，容易出现运行时 singleton 版本漂移。
Python 已有单一 `uv.lock`，Go 服务则必须保持可独立构建。

## Decision

- 前端 pnpm workspace 使用 `catalog:` 管理共享的直接依赖；React、Router、Zustand、
  React Compiler runtime 与 AI SDK 同时通过 `overrides` 约束整个依赖图。
- 后端 Node workspace 延续现有 pnpm catalog；前后端是独立 pnpm 解析边界，不共享 lockfile。
- Python 以根目录 `uv.lock` 作为所有 workspace member 的精确依赖事实来源；CI 使用
  `uv lock --check` 拒绝未提交的锁文件变更。
- 每个 Go 服务以 `GOWORK=off` 构建，并在 CI 中执行 `go mod tidy` 后检查 `go.mod` 和
  `go.sum` 无差异。`go.work` 仅用于本地多模块开发。
- Renovate 负责更新提案，按 React Module Federation、Vercel AI SDK 与各语言
  OpenTelemetry 依赖组创建升级 PR。

## Consequences

- 改动前端共享依赖的版本只需编辑 `apps/frontend/pnpm-workspace.yaml` 和锁文件。
- 新增共享前端依赖必须先登记 catalog；`catalogMode: strict` 会阻止绕过该入口的
  `pnpm add`。
- 仅在已确认的安全修复或上游元数据问题时，才对 Python 使用 uv override，或对 pnpm
  使用额外 override；它们不是常规版本声明方式。
