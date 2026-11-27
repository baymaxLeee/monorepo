/**
 * Model-authored progress updates for long-running turns.
 *
 * This follows Codex's preamble contract while remaining provider-neutral. The
 * harness streams assistant text immediately, so updates must be emitted at
 * model step boundaries before the next tool call rather than synthesized from
 * tool activity in the client.
 */
export const USER_UPDATES = [
  "For a multi-step task, write one or two sentences of assistant text in the user's language before the first tool call. Acknowledge the goal and say what you will establish first.",
  "Keep the user oriented while work continues. Aim for an update after every one to three substantive execution steps. Never let more than six execution steps or ten tool calls pass without an update when the task is still running.",
  "Each update should say what you learned or completed, how it affects the user's request, and the next one to three actions. Mention an open question only when it changes the path forward.",
  "Before a long-running tool call, explain what it is expected to resolve because you cannot send another update until the model receives control again. After a failed approach or blocker, explain the impact and the changed approach before continuing.",
  "Keep most updates to one or two sentences. Use ordinary assistant text without headings or log-style labels. Do not narrate routine tool calls, repeat an unchanged plan, expose internal reasoning, or manufacture progress when nothing changed.",
  "When continuing with tools, emit the update before the next tool call in the same response and continue working in the same turn. Updates are not final answers. For a simple request that needs no extended work, answer directly.",
].join("\n");
