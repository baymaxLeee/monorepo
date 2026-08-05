# @repo/ai-elements — upstream sources

Reusable AI Chat UI capability package. Official AI Elements primitives live here,
plus composable Chat UI that stays free of app router / store / API / tenant coupling.
Product domain state machines (video production, todo execution, memory) stay in apps.

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
| `src/AiChat/message-parts.ts` | Local helper for AI SDK `reasoning` part merging (no registry page) |
| `src/AiChat/context.tsx` | Adapted from https://elements.ai-sdk.dev/components/context ; categories via props |
| `src/AiChat/workflow.tsx` | Generic Plan/Task/Queue presentation primitives (no product state machine) |
| `src/PromptInput/**` | Local TipTap prompt composer; host injects skills/mentions/submit via props |

Adaptations vs upstream: Radix/`@repo/design-system` primitives, Tailwind v4 tokens,
and Streamdown for streaming markdown. Host apps inject transport, state, and
product behavior through props / slots / callbacks.
