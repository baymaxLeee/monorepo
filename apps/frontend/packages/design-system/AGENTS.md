# Design system

Read root [DESIGN.md](../../../../DESIGN.md) before changing primitives, theme,
layout, forms or overlays. It is the UI contract; this package owns its reusable
implementation.

- `src/styles.css` is the single Tailwind v4 theme and global style entry loaded by
  Platform. Keep app/capability selectors and component-owned CSS out of it. Add a
  new UI package to its `@source` inputs when required.
- `src/shadcn/` keeps flat kebab-case Base Nova primitives with named exports.
  Business code imports public `@repo/design-system` entries, never private source.
- Use root `just ui-add <component...> --overwrite -y`; inspect `--dry-run`,
  `--diff` or `--view` first. Review the complete generated diff and restore the
  package's theme, export and portal integrations. Do not recreate registry source
  from memory or introduce a second primitive system.
- Base UI composition uses `render={<Element />}` rather than new Radix `asChild`
  patterns. Keep the official registry baseline; repository extensions stay
  narrow and centralized.
- Modal and popup primitives use the existing portal-layer implementation and the
  overlay contract in `DESIGN.md`. Do not expose business z-index tables or pass
  numeric layering through component trees.
- Standard forms use React Hook Form, Zod and the existing Field composition.
  Shared page structure uses the exported Page primitives.
- This `ui` package may depend only on `ui` and `util` packages. It must not import
  API, runtime or application state.

Run the package typecheck/tests, affected consumer typechecks and the Platform
build when public exports, theme scanning, CSS or overlay behavior changes.
