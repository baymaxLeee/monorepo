import { Button } from "@repo/design-system/shadcn/button";
import { InputGroupAddon } from "@repo/design-system/shadcn/input-group";
import { ArrowUp, Loader2, Plus, Square } from "lucide-react";

import type { PromptInputApi, PromptInputProps } from "../interface";

export function PromptInputActions({
  api,
  disabled,
  loading,
  attachmentsUploading,
  submitLabel,
  onStop,
  footerRender,
  onAttach,
}: Pick<PromptInputProps, "disabled" | "loading" | "submitLabel" | "onStop" | "footerRender"> & {
  api: PromptInputApi;
  attachmentsUploading: boolean;
  onAttach: () => void;
}) {
  return (
    <InputGroupAddon align="block-end" className="prompt-input-footer">
      <div className="prompt-input-tools">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          disabled={disabled}
          onClick={onAttach}
          aria-label="添加附件"
        >
          <Plus className="size-4" />
        </Button>
        {footerRender?.(api)}
      </div>
      <Button
        type={loading && onStop ? "button" : "submit"}
        size="icon-xs"
        className="rounded-full mr-2 cursor-pointer"
        disabled={loading ? !onStop : disabled || attachmentsUploading}
        aria-label={loading && onStop ? "停止生成" : attachmentsUploading ? "附件上传中" : "发送消息"}
        onClick={loading ? onStop : undefined}
      >
        {submitLabel ??
          (loading ? (
            <Square className="size-3" />
          ) : attachmentsUploading ? (
            <Loader2 className="size-3 motion-safe:animate-spin" />
          ) : (
            <ArrowUp className="size-3" />
          ))}
      </Button>
    </InputGroupAddon>
  );
}
