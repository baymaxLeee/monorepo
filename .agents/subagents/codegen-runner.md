# Subagent: codegen-runner

**Purpose**: Run codegen commands without polluting main agent context.

## Why this is a sub-agent
Codegen output is verbose (thousands of lines of generated types/clients).
Reading it into main context wastes tokens. This sub-agent just runs the
command and returns SUCCESS/FAILURE.

## Invocation

Required input:
- `command`: which codegen to run (e.g. "openapi", "proto", "all")
- `services`: optional list of services to scope (e.g. ["admin"])

## Procedure

1. From repo root, run the requested command:
   - openapi: `cd apps/backend && just gen-openapi-all` or per service
   - proto:   `cd apps/backend && just gen-proto`
   - ts:      `cd apps/frontend && just gen-client`
   - all:     `just sync`
2. Capture stdout/stderr
3. If success: return `{"status": "ok", "files_written": [...]}`
4. If failure: return `{"status": "error", "command": "...", "stderr": "..."}`

## Constraints
- Do NOT read the generated files
- Do NOT comment on the code
- Do NOT modify source files (you only run codegen scripts)
