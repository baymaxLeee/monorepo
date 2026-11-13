import { PromptInput, type PromptInputProps, type PromptInputRef } from "@repo/ai-elements/prompt-input";
import type { Ref } from "react";

// Both execution modes use the same composer sizing, editor and submit controls.
export function ChatPrompt({ ref, ...props }: PromptInputProps & { ref?: Ref<PromptInputRef> }) {
  return (
    <footer className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-2 pb-4">
      <PromptInput ref={ref} {...props} />
    </footer>
  );
}
