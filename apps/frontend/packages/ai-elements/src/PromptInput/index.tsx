import { Lazy } from "@repo/design-system/lazy";
import { cn } from "@repo/shared";
import { forwardRef } from "react";

import type { PromptInputProps, PromptInputRef } from "./interface";

import "./styles.css";

const loadPromptInput = () => import("./components/Editor");

const PromptInput = forwardRef<PromptInputRef, PromptInputProps>(function PromptInput(props, ref) {
  const { style, className } = props;
  return (
    <Lazy<PromptInputProps>
      {...props}
      loader={loadPromptInput}
      ref={ref}
      fallback={<div style={style} className={cn("prompt-input", className)} />}
    />
  );
});

export { PromptInput };
export default PromptInput;

export type {
  PromptInputApi,
  PromptInputProps,
  PromptInputRef,
  PromptInputRenderContext,
  PromptInputSegment,
  PromptInputToken,
  PromptInputTokenKind,
  PromptInputValue,
  PromptMentionItem,
  PromptMentionSource,
  PromptSkillsLoad,
  PromptSlashCommand,
  PromptSlashSource,
} from "./interface";
