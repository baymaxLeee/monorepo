import { PromptInput, type PromptInputProps, type PromptInputRef } from "@repo/ai-elements/prompt-input";
import type { Ref } from "react";

import { ChatActivePlan } from "./ChatActivePlan";
import type { ActiveTodoList } from "./ChatPlanState";

export function ChatPrompt({
  ref,
  activePlan,
  ...props
}: Omit<PromptInputProps, "headerRender"> & { ref?: Ref<PromptInputRef>; activePlan?: ActiveTodoList | null }) {
  return (
    <footer className="relative z-10 mx-auto w-full max-w-4xl shrink-0 bg-gradient-to-t from-background from-70% to-transparent px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <PromptInput
        ref={ref}
        {...props}
        headerRender={activePlan ? () => <ChatActivePlan plan={activePlan} /> : undefined}
      />
    </footer>
  );
}
