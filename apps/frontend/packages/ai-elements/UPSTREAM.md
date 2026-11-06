# @repo/ai-elements — upstream sources

AI Elements follows the [October 2026 shadcn/ui patterns](https://ui.shadcn.com/docs/ai-elements).
These are source-owned compositions, not an installed AI Elements runtime package.
Base Nova primitives are generated with the official shadcn CLI in `design-system`.
The compositions below adapt the official examples and migration prompts to this
workspace's public imports, theme, AI SDK parts and product callbacks.

| Official pattern | Local module |
| --- | --- |
| Chain of Thought | `src/AiChat/chain-of-thought.tsx` |
| Chat | `src/AiChat/conversation.tsx` (shadcn Message Scroller) |
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
artifact previews and user-controlled disclosure. The searchable
selector serves configured bots; `ModelPicker` provides the official radio-menu
pattern for small model or reasoning-option lists. TipTap retains attachments,
mentions and slash commands while Input Group owns the composer frame.
`artifact.tsx` and `attachments.tsx` retain the existing source-owned APIs.
Subagent, checkpoint and test results remain presentation capabilities. The Chat
consumer binds them to actual delegated file progress, a server-owned conversation
fork, and complete TAP 13 terminal reports; no parallel runtime or test runner is
introduced. Context uses Base UI Meter and a click/keyboard-accessible Popover.

MessageResponse keeps Streamdown sanitize/harden and blocks ambient external/data
image requests. Authenticated file/artifact media remains separate. The host scans
Streamdown/plugin distribution files for Tailwind classes and supplies Chinese
control labels. PromptInput suggestions use Base UI Popover in the owner React
tree; generic token status is independent of Knowledge ingest metadata.
Regression fixtures use the official [`@shadcn/helpers/ai-sdk`](https://ui.shadcn.com/docs/helpers/ai-sdk)
transport with real SDK hooks, including approval denial and history hydration.

Conversation follows the current [shadcn Chat composition and migration guide](https://ui.shadcn.com/docs/ai-elements/base/chat),
using Message Scroller from `@shadcn/react`. Every transcript row, including
placeholders, is a MessageScrollerItem; user messages anchor new turns.
The provider owns resize observation, position and following. Explicit jumps use
`behavior="auto"` to avoid extra motion during streaming.
Reasoning follows the [shadcn Trace disclosure pattern](https://ui.shadcn.com/docs/ai-elements/base/reasoning):
expanded reasoning grows in the conversation viewport, without its own height
limit or scroll button.

`conversation-viewport.tsx` handles a reproduced `@shadcn/react` 0.3.1 edge case:
an input event at the bottom clears following even when no native scroll event
occurs. Downward wheel, keyboard and touch input at the physical bottom invokes
the public `scrollToEnd` command. This keeps upstream state authoritative without
another following flag, observer or animation loop. Regression tests cover this
boundary; re-evaluate the adaptation when upgrading the upstream package.
Downward, horizontal and zero-delta trackpad tails preserve the upstream live-edge
state reported by `useMessageScrollerScrollable`, including when content has grown
but resize handling is pending. Upward input still stops following; input while
reading history must not jump to the bottom.
The focused viewport's End key also uses that command so a native animated jump
cannot finish at an outdated bottom while new chunks arrive.

Tool details use [shadcn Trace disclosure](https://ui.shadcn.com/docs/ai-elements/base/tool).
Our conversation defaults ordinary tools and terminal logs to collapsed summaries;
approvals, questions and errors remain visible. Expanding details grows the shared
viewport instead of creating another bounded output scroller. Streamdown's native
[`codeBlockMaxHeight` and `tableMaxHeight`](https://streamdown.ai/docs/configuration)
are set to `0` for messages, retaining horizontal scrolling for wide content.
