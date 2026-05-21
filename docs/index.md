# Documentation

Welcome. This index is the entry point for ALL documentation.

## Reading order for new contributors

1. Repo root `README.md` — quick start
2. Repo root `AGENTS.md` — universal rules (also for AI agents)
3. `docs/系统架构/` — architecture overview
4. `docs/微服务/index.md` — backend microservice patterns
5. `docs/微前端/index.md` — frontend MFE patterns
6. `docs/开发规范/` — coding conventions
7. `docs/多agent协作/` — how to use AI agents on this repo

## Layout

| Folder | Topic |
|---|---|
| `ADR/` | Architecture Decision Records |
| `系统架构/` | Cross-cutting architecture |
| `微服务/` | Per-service docs and patterns |
| `微前端/` | Per-MFE docs and patterns |
| `领域模型/` | Domain glossary |
| `开发规范/` | Style, error, audit, permission conventions |
| `多agent协作/` | AI agent collaboration patterns |

## Adding new documentation

- Per-domain docs go to the relevant module folder (e.g. `docs/微服务/<svc>.md`)
- Architectural decisions → `docs/ADR/NNNN-<slug>.md`
- Cross-cutting only → `docs/系统架构/` or `docs/开发规范/`
- Always update the relevant module's `index.md` when adding a file
