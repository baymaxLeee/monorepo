# AI Elements

`@repo/ai-elements` owns the repository's AI interface stack. CLI-copied and upstream-derived primitives stay in `src/AiChat`; the rich prompt input stays in `src/PromptInput`. Repository-specific session, stream, tool and workspace compositions live in `src/Conversation` and are exported from `@repo/ai-elements/conversation`.

## Component CLI

Run from the repository root:

```bash
just ai-add --help
just ai-add @ai-elements/message --dry-run
just ai-add @ai-elements/reasoning --view reasoning.tsx
just ai-add @ai-elements/message --diff
just ai-add @ai-elements/message @ai-elements/reasoning
```

Both UI packages use the official CLI directly: `"ui:add": "shadcn add"`.

| Package | Root command | Package script |
| --- | --- | --- |
| `@repo/ai-elements` | `just ai-add @ai-elements/message --dry-run` | `pnpm --dir apps/frontend/packages/ai-elements ui:add @ai-elements/message --dry-run` |
| `@repo/design-system` | `just ui-add button --dry-run` | `pnpm --dir apps/frontend/packages/design-system ui:add button --dry-run` |

Both packages declare the same catalog-pinned shadcn version. Root recipes only set the package directory through `pnpm --dir`; all arguments and behavior come from shadcn. Use `@ai-elements/<name>` for the official Vercel registry and bare names for shadcn Base Nova. Append `--dry-run`, `--diff` or `--view` to preview.

Registry sources land in `src/components/ai-elements/`, separate from existing adapted compositions. They are available through `@repo/ai-elements/components/ai-elements/<name>`. `components.json` routes UI dependencies to `@repo/design-system/shadcn` and utilities to `@repo/shared`. The preview can include shared primitive and dependency updates: inspect the whole diff before applying, including design-system changes.

The [Vercel registry](https://elements.ai-sdk.dev/docs/setup) supplies the older AI SDK Elements sources. Those may contain Radix-specific hooks or `asChild`; they are not automatically compatible with this repository's Base UI stack. Preview, adapt the owned source to Base UI and the public workspace imports, and run the checks below before exposing it to an app. Preserve modal layers, stream semantics, and existing customized components when updating a composition.

For current implementations, use the [shadcn AI Elements Base patterns](https://ui.shadcn.com/docs/ai-elements): these are documented compositions rather than additional registry packages. Existing registry files do not update themselves when upstream changes.

## Verify an addition

```bash
just test frontend/@repo/ai-elements
just lint
pnpm --dir apps/frontend --filter chat build
```

Keep CLI-copied elements out of `src/Conversation`, and keep API/runtime-aware business orchestration out of `src/AiChat`. Use separate subpaths for heavy components; apps must not import private `src` paths.
