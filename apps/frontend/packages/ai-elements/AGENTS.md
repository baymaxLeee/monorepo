# AI interface components

Use current shadcn AI Elements Base patterns and the existing design-system primitives. `src/AiChat` contains CLI-copied, upstream-derived elements; `src/Conversation` owns the repository's Chat session and stream compositions. The rich prompt input remains in the separate `src/PromptInput` subpath.

- Use root `just ai-add @ai-elements/<name> --dry-run` or `--view` to inspect official Vercel registry sources. The CLI workflow and public source path are documented in [README.md](README.md). Do not recreate a registry component from memory.
- The legacy registry can include Radix hooks and `asChild`. Adapt those sources to Base UI and public workspace imports before using them. Do not replace the current compositions or overwrite shared primitives without reviewing their complete diff. The CLI never performs that adaptation automatically.
- Keep heavy components out of the main barrel; expose them with package subpaths. Preserve platform-owned CSS, modal layers, and official SDK parts.
- Verify additions with `just test frontend/@repo/ai-elements`, the affected consumers' tests/typechecks/builds, and root `just lint`.
