# api-client — AUTO-GENERATED

⚠️ DO NOT hand-edit files under any `<service>/generated/` directory.

They are produced by:

    cd apps/frontend && just gen-client    # OR
    just sync                              # (from repo root)

Source of truth: `schemas/openapi/<service>.json` (exported from each backend service).

## Layout

```
packages/api-client/
├── admin/
│   ├── src/
│   │   ├── index.ts          # public re-exports (hand-written, thin)
│   │   └── client.ts         # hand-written wrapper using generated types
│   └── generated/            # AUTO-GEN (gitignored)
│       └── schema.d.ts
├── identity/
│   └── ...
└── scripts/codegen.sh
```

## Adding a new service client

1. Backend service must export OpenAPI to `schemas/openapi/<name>.json`
2. Add `<name>/` directory under `packages/api-client/`
3. Update `scripts/codegen.sh` to include the new service
4. Add `./` export entry in `packages/api-client/package.json`
5. Run `just gen-client` from frontend root

## Why both `generated/` and `src/`?
- `generated/` = raw types from OpenAPI (changes with API changes)
- `src/` = stable public surface (wrapper functions, hooks); shields consumers
  from generated path churn
