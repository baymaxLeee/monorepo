import { PromptInput, type PromptInputProps, type PromptInputRef } from "@repo/ai-elements/prompt-input";
import type { Ref } from "react";

import { PendingInputStack, type PendingAgentInput } from "./PendingInputStack";

// Both execution modes use the same composer sizing, editor and submit controls.
export function ChatPrompt({
  ref,
  pendingInputs = [],
  ...props
}: PromptInputProps & { ref?: Ref<PromptInputRef>; pendingInputs?: readonly PendingAgentInput[] }) {
  return (
    <footer className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-2 pb-4">
      <PendingInputStack inputs={pendingInputs} />
      <PromptInput ref={ref} {...props} />
    </footer>
  );
}
