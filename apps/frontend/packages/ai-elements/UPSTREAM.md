# @repo/ai-elements — upstream sources

Reusable AI Chat UI capability package. Official AI Elements primitives live here,
plus composable Chat UI that stays free of app router / store / API / tenant coupling.
Product domain state machines (video production, todo execution, memory) stay in apps.

The complete public API of every locally owned AI Elements component was rebased
against the AI Elements 1.9 registry on 2026-09-23. Components with no product
caller remain registry-installable instead of being copied into this package as
dead code.

| Local module | Upstream reference |
|---|---|
| `src/AiChat/artifact.tsx` | https://elements.ai-sdk.dev/components/artifact |
| `src/AiChat/attachments.tsx` | https://elements.ai-sdk.dev/components/attachments |
| `src/AiChat/confirmation.tsx` | https://elements.ai-sdk.dev/components/confirmation |
| `src/AiChat/conversation.tsx` | https://elements.ai-sdk.dev/components/conversation |
| `src/AiChat/message.tsx` | https://elements.ai-sdk.dev/components/message |
| `src/AiChat/model-selector.tsx` | https://elements.ai-sdk.dev/components/model-selector |
| `src/AiChat/reasoning.tsx` | https://elements.ai-sdk.dev/components/reasoning |
| `src/AiChat/sources.tsx` | https://elements.ai-sdk.dev/components/sources |
| `src/AiChat/suggestion.tsx` | https://elements.ai-sdk.dev/components/suggestion |
| `src/AiChat/tool.tsx` | https://elements.ai-sdk.dev/components/tool |
| `src/AiChat/context.tsx` | Adapted from https://elements.ai-sdk.dev/components/context ; categories via props |
| `src/AiChat/workflow.tsx` | Generic Plan/Task/Queue presentation primitives (no product state machine) |
| `src/PromptInput/**` | Local TipTap prompt composer; host injects skills/mentions/submit via props |

Adaptations vs upstream: Base UI/`@repo/design-system` primitives, Tailwind v4 tokens,
safe external URLs, artifact previews, persisted AI SDK tool parts, and bounded
reasoning/tool content with streaming auto-scroll. Message and reasoning markdown
share the upstream Streamdown CJK, code, math, and Mermaid plugin baseline. Host apps
inject transport, state, and product behavior through props / slots / callbacks.

The upstream composition APIs are retained even when the current product does not yet
render them: message actions/branches, attachment hover/empty states, source
collapsibles, tool input/output, and the command-dialog model selector.
