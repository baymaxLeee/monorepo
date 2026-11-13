import { Button } from "@repo/design-system/shadcn/button";
import { InputGroupAddon } from "@repo/design-system/shadcn/input-group";
import { ArrowUp, Loader2, Plus, Square } from "lucide-react";

import type { PromptInputApi, PromptInputProps } from "../interface";

export function PromptInputActions({
  api,
  disabled,
  loading,
  submitWhileLoading,
  attachmentsUploading,
  submitLabel,
  onStop,
  footerRender,
  onAttach,
  attachmentsEnabled = true,
}: Pick<PromptInputProps, "disabled" | "loading" | "submitWhileLoading" | "submitLabel" | "onStop" | "footerRender"> & {
  api: PromptInputApi;
  attachmentsUploading: boolean;
  onAttach: () => void;
  attachmentsEnabled?: boolean;
}) {
  return (
    <InputGroupAddon align="block-end" className="prompt-input-footer">
      <div className="prompt-input-tools">
        {attachmentsEnabled ? (
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
        ) : null}
        {footerRender?.(api)}
      </div>
      <div className="mr-2 flex items-center gap-1">
        {loading && submitWhileLoading && onStop ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="rounded-full"
            aria-label="停止生成"
            onClick={onStop}
          >
            <Square className="size-3" />
          </Button>
        ) : null}
        <Button
          type={loading && !submitWhileLoading && onStop ? "button" : "submit"}
          size="icon-xs"
          className="rounded-full cursor-pointer"
          disabled={loading && !submitWhileLoading ? !onStop : disabled || attachmentsUploading}
          aria-label={
            loading && !submitWhileLoading && onStop
              ? "停止生成"
              : attachmentsUploading
                ? "附件上传中"
                : loading
                  ? "补充当前任务"
                  : "发送消息"
          }
          onClick={loading && !submitWhileLoading ? onStop : undefined}
        >
          {submitLabel ??
            (loading && !submitWhileLoading ? (
              <Square className="size-3" />
            ) : attachmentsUploading ? (
              <Loader2 className="size-3 motion-safe:animate-spin" />
            ) : (
              <ArrowUp className="size-3" />
            ))}
        </Button>
      </div>
    </InputGroupAddon>
  );
}
