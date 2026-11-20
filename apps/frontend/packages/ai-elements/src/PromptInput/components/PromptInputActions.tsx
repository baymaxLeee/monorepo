import { Button } from "@repo/design-system/shadcn/button";
import { InputGroupAddon } from "@repo/design-system/shadcn/input-group";
import { ArrowUp, Loader2, Plus, Square } from "lucide-react";

import { composerControlClassName } from "../../composer-control-styles";
import type { PromptInputApi, PromptInputProps } from "../interface";

export function PromptInputActions({
  api,
  disabled,
  loading,
  submitWhileLoading,
  attachmentsUploading,
  hasContent,
  submitLabel,
  onStop,
  footerStartRender,
  footerEndRender,
  onAttach,
  attachmentsEnabled = true,
}: Pick<
  PromptInputProps,
  "disabled" | "loading" | "submitWhileLoading" | "submitLabel" | "onStop" | "footerStartRender" | "footerEndRender"
> & {
  api: PromptInputApi;
  attachmentsUploading: boolean;
  hasContent: boolean;
  onAttach: () => void;
  attachmentsEnabled?: boolean;
}) {
  const stopsRun = Boolean(loading && onStop && (!submitWhileLoading || !hasContent));
  return (
    <InputGroupAddon align="block-end" className="prompt-input-footer min-h-10">
      <div className="prompt-input-tools">
        {attachmentsEnabled ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={`rounded-full ${composerControlClassName}`}
            disabled={disabled}
            onClick={onAttach}
            aria-label="添加附件"
          >
            <Plus className="size-4" />
          </Button>
        ) : null}
        {footerStartRender?.(api)}
      </div>
      <div className="prompt-input-actions">
        {footerEndRender?.(api)}
        <Button
          type={stopsRun ? "button" : "submit"}
          size="icon-xs"
          className={`cursor-pointer rounded-full ${composerControlClassName}`}
          disabled={loading && !submitWhileLoading ? !onStop : disabled || attachmentsUploading}
          aria-label={
            stopsRun ? "停止生成" : attachmentsUploading ? "附件上传中" : loading ? "补充当前任务" : "发送消息"
          }
          onClick={stopsRun ? onStop : undefined}
        >
          {submitLabel ??
            (stopsRun ? (
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
