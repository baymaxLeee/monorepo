# @repo/ai-elements — upstream sources

AI Elements follows the [October 2026 shadcn/ui patterns](https://ui.shadcn.com/docs/ai-elements).
These are source-owned compositions, not an installed AI Elements runtime package.
Base Nova primitives are generated with the official shadcn CLI in `design-system`.
The compositions below adapt the official examples and migration prompts to this
workspace's public imports, theme, AI SDK parts and product callbacks.

| Official pattern | Local module |
| --- | --- |
| Chain of Thought | `src/AiChat/chain-of-thought.tsx` |
| Chat | `src/AiChat/conversation.tsx` (Message Scroller) |
| Checkpoint | `src/AiChat/checkpoint.tsx` |
| Confirmation | `src/AiChat/confirmation.tsx` |
| Context | `src/AiChat/context.tsx` |
| File Tree | `src/AiChat/file-tree.tsx` |
| Inline Citation, Sources | `src/AiChat/sources.tsx` |
| Message | `src/AiChat/message.tsx` (Message, Bubble, Streamdown) |
| Model Selector | `src/AiChat/model-picker.tsx`; searchable `model-selector.tsx` |
| Plan, Queue, Task | `src/AiChat/workflow.tsx` |
| Prompt Input | `src/PromptInput/` (Input Group with TipTap) |
| Reasoning | `src/AiChat/reasoning.tsx` |
| Stack Trace | `src/AiChat/stack-trace.tsx` |
| Subagent | `src/AiChat/subagent.tsx` |
| Suggestion | `src/AiChat/suggestion.tsx` |
| Terminal | `src/AiChat/terminal.tsx` |
| Test Results | `src/AiChat/test-results.tsx` |
| Tool | `src/AiChat/tool.tsx` |

Trace and Code Block come from `@repo/design-system`. Terminal and highlighted
code use `@repo/ai-elements/terminal` and `/code-block` subpaths. The composer
remains under `/prompt-input` so its editor is loaded only when needed.

Local adaptations retain safe external URLs, tool outcome presentation,
artifact previews, bounded output and user-controlled disclosure. The searchable
selector serves configured bots; `ModelPicker` provides the official radio-menu
pattern for small model or reasoning-option lists. TipTap retains attachments,
mentions and slash commands while Input Group owns the composer frame.
`artifact.tsx` and `attachments.tsx` retain the existing source-owned APIs.
Subagent, checkpoint and test results are presentation capabilities; they do not
create an agent runtime, restore operation or test runner.
