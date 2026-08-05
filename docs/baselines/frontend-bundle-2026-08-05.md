# Frontend bundle baseline (2026-08-05)

Recorded from `cd apps/frontend && just build` after the capability package split.
These are observations only — no hard limits.

| App | Asset | Size |
|---|---|---|
| admin | `9513.766f321d.js` | 425.999 KiB |
| admin | `5263.960f778c.js` | 309.257 KiB |
| admin | `5014.91182990.js` | 467.931 KiB |
| admin | `2686.356522c9.js` | 568.678 KiB |
| admin | `32f279dec6b4d4a0.mjs` | 949.784 KiB |
| chat | `2999.944cf67f.js` | 589.287 KiB |
| platform | `runtime/echarts/6.1.0/echarts.min.js` | 1.070 MiB |

Notes:

- platform large asset is vendored echarts runtime.
- admin large chunks include editors/viewers demos.
- chat large chunk includes AI chat surface.
