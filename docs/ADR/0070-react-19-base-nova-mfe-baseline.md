# ADR-0070: React 19 and complete Base Nova MFE baseline

## Status

Accepted

## Date

2026-09-23

## Context

The frontend previously targeted React 18 and federated `react-compiler-runtime`. The complete current shadcn Base Nova registry also includes `message-scroller` and `questionnaire`, whose official `@shadcn/react` implementation requires React 19. The repository has no legacy compatibility obligation, but React cannot be upgraded independently of Rspack, React Compiler, or the Module Federation share scope.

Current package metadata confirms that React 19 is accepted by Base UI, React Router, TanStack Query, Zustand, Tiptap, XYFlow, React Hook Form, Recharts, and the AI SDK React binding. Rspack 2.2 supports React Compiler target 19, and Module Federation Enhanced 2.9 accepts Rspack 2.

## Decision

- Use one catalog- and override-enforced React 19 / React DOM 19 / React type tree.
- Use Rspack 2.2 and Module Federation Enhanced 2.9 as the MFE build/runtime baseline.
- Share `react`, both JSX runtime entries, `react-dom`, and `react-dom/client` as strict `^19.0.0` singletons. The host provides them and remotes use `import: false`, so independently deployed remotes cannot silently bundle a second React runtime.
- Compile all four MFEs with React Compiler target `19`. Remove `react-compiler-runtime` from the catalog, packages, and federation share scope because React 19 provides the runtime natively.
- Maintain the complete stable shadcn Base Nova registry in `@repo/design-system`, including the official `@shadcn/react` composites. Generate registry upgrades in one CLI operation, then reapply the repository-owned portal layering and React Hook Form integrations.
- Keep Base UI as the only headless primitive foundation. `@shadcn/react` is limited to official shadcn composite behaviors and is not a second primitive or styling system.

## Consequences

- Host and remotes fail loudly on an incompatible React major instead of risking duplicate hooks or context identity.
- React Compiler no longer adds a compatibility-runtime package or federation entry.
- The design system follows the complete upstream Base Nova surface while preserving repository-level theme, exports, forms, and overlay semantics.
- A React, Rspack, Module Federation, or full-registry update must be validated together with peer checks, all workspace typechecks, all four production MFE builds, frontend lint, and an audit for duplicate React versions.
