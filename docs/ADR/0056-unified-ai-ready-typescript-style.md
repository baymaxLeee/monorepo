# ADR 0056: Unified AI-ready TypeScript style

## Status

Accepted.

## Context

Frontend TypeScript used Biome while backend Node services treated TS7 typechecking as linting. The split allowed
formatting and correctness rules to drift, made package commands disagree with `just`, and produced diagnostics that
were unnecessarily verbose for coding agents.

Current Oxc guidance positions Oxlint as a fast TypeScript linter with TS7-backed type-aware analysis and
machine-actionable diagnostics. Oxfmt explicitly favors wider TypeScript lines partly because fewer forced line breaks
consume fewer LLM tokens. Ultracite provides a useful AI-ready rule benchmark, but its broad preset dependency is not
required at runtime.

## Decision

- Use root `oxlint.config.ts` and `oxfmt.config.ts` as the only JS/TS style configuration.
- Use Oxfmt with a 120-column default, two spaces, double quotes, semicolons, trailing commas, LF endings, and sorted
  imports.
- Permit a narrow per-file width override when the default formatter would violate an explicit repository line-count
  ceiling; this does not change the 120-column project default.
- Use Oxlint's `agent` formatter and TS7 type-aware rules. Routine CLI runs use `--quiet`: high-confidence correctness
  errors block, while existing migration findings remain available as editor warnings without flooding agent context.
- Keep TS7 `tsc --noEmit` as the authoritative typecheck; Oxlint's experimental `typeCheck` replacement remains off.
- Exclude generated sources, migrations, dependencies, and build output.
- Keep the installed toolchain limited to Oxfmt, Oxlint, and `oxlint-tsgolint`; encode the reviewed Ultracite-inspired
  choices locally instead of importing its much broader preset dependency graph.
- Route root, frontend, backend, package, and `just lint/fmt` commands through the same configuration.
- Remove Biome rather than retain a compatibility layer.

## Consequences

Humans and coding agents get deterministic formatting and compact diagnostics across frontend and backend. A single
CLI migration can produce a large one-time formatting diff. Rules that are still noisy are advisory instead of being
silenced permanently or blocking delivery.

## References

- [Oxlint overview](https://oxc.rs/docs/guide/usage/linter.html)
- [Oxlint type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware)
- [Oxfmt configuration](https://oxc.rs/docs/guide/usage/formatter/config.html)
- [Ultracite](https://www.ultracite.ai/)
