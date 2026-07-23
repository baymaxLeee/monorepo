# ADR 0053: Admin provider token units

## Status

Accepted.

## Context

Model catalogs present context and output limits in K-token units, while the
Admin provider form previously required raw token counts such as `1048576` and
`393216`. Those values are difficult to compare with provider documentation and
easy to mistype. Chat and executor still require exact token counts for AI SDK
request settings and context-budget arithmetic.

## Decision

- The public Admin provider API and Admin MFE use `context_window_k` and
  `max_output_tokens_k`, where `1K = 1024 tokens`.
- Inputs support quarter-K increments so existing exact values such as 32,000
  tokens round-trip as `31.25K` without data loss.
- Admin converts K-token inputs to exact integer tokens at the application
  boundary and stores integer tokens in `model_providers`.
- Internal provider endpoints keep `context_window` and `max_output_tokens` in
  exact tokens. Chat and executor therefore continue passing native token
  counts to the AI SDK without display-unit conversion.
- Model presets are authored directly in K-token units, matching the values
  operators compare against provider model catalogs.

## Consequences

- DeepSeek V4 Pro is configured as `1024K / 384K` instead of
  `1,048,576 / 393,216`.
- Public and internal provider DTOs intentionally use different field names;
  mixing the two contracts becomes a type error rather than a silent 1024x
  budget mistake.
- No database migration is required because persisted units remain exact
  tokens.
