import type { CanvasNode } from "@repo/api";
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { Check, LoaderCircle, Pencil, Settings2, Sparkles } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { GenerationSettings } from "../GenerationSettings";
import type { NodeEditorHandle } from "../NodeEditor";
import { AssetStrip } from "../prompt/AssetStrip";
import { PromptEditor } from "../prompt/PromptEditor";
import { addPromptReference } from "../prompt/references";

export const ShotEditor = forwardRef<
  NodeEditorHandle,
  {
    node: CanvasNode;
    projectId: string;
    canvasId: string;
    index: number;
    busy: boolean;
    locked: boolean;
    onSave: (node: CanvasNode) => Promise<void>;
    onMatch?: () => void;
    onCancelMatch?: () => void;
    matching: boolean;
    cancelling?: boolean;
    matchError?: string;
  }
>(function ShotEditor(
  { node, projectId, canvasId, index, busy, locked, onSave, onMatch, onCancelMatch, matching, cancelling, matchError },
  ref,
) {
  const form = useForm<CanvasNode>({ defaultValues: node });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef<Promise<void> | null>(null);
  const dirty = form.formState.isDirty;
  const conflict = form.watch("revision") !== node.revision && dirty;
  useEffect(() => {
    if (!dirty) form.reset(node);
  }, [node, dirty, form]);
  function finish() {
    if (saving.current) return saving.current;
    const work = (async () => {
      if (form.formState.isDirty) {
        if (locked || conflict || !(await form.trigger())) throw new Error("请先处理分镜校验错误或编辑冲突");
        const next = form.getValues();
        await onSave(next);
        form.reset(next);
      }
      setError("");
      setEditing(false);
    })();
    saving.current = work;
    void work
      .catch((cause: unknown) => setError(getErrorMessage(cause, "保存失败，已保留当前脚本")))
      .finally(() => {
        saving.current = null;
      });
    return work;
  }
  useImperativeHandle(ref, () => ({ finish }));
  return (
    <Form {...form}>
      <form
        className="flex min-h-0 flex-1 flex-col gap-4 p-5 pr-2"
        onSubmit={(event) => {
          event.preventDefault();
          void finish().catch(() => {});
        }}
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-sm text-muted-foreground">分镜 {index + 1}</span>
            <FormField
              control={form.control}
              name="name"
              rules={{ required: "请输入分镜名称", maxLength: { value: 50, message: "名称最多 50 字" } }}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={locked}
                      aria-label="分镜名称"
                      className="w-44 border-transparent bg-transparent text-base font-medium shadow-none hover:border-input"
                      onFocus={() => setEditing(true)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => setEditing(true)}>
                  <Settings2 className="size-4" />
                  生成设置
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <GenerationSettings form={form} type={6} disabled={busy || locked} />
              </PopoverContent>
            </Popover>
            {editing ? (
              <>
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    form.reset(node);
                    setEditing(false);
                    setError("");
                  }}
                >
                  取消
                </Button>
                <Button size="sm" type="submit" disabled={busy || locked || conflict || !dirty}>
                  <Check className="size-4" />
                  保存
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
                编辑
              </Button>
            )}
          </div>
        </header>
        <AssetStrip form={form} disabled={busy || locked || !editing} projectId={projectId} canvasId={canvasId} />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-background">
          <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
            <h2 className="font-medium">分镜脚本</h2>
            {onMatch && node.video_input_mode !== 2 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy || cancelling || (!matching && (locked || !form.watch("prompt").trim()))}
                onClick={matching ? onCancelMatch : onMatch}
              >
                {matching ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {matching ? (cancelling ? "取消中…" : "取消匹配") : "素材智能匹配"}
              </Button>
            ) : null}
          </div>
          <FormField
            control={form.control}
            name="prompt"
            rules={{ required: "请输入分镜脚本", maxLength: { value: 30000, message: "脚本最多 30000 字符" } }}
            render={({ field }) => (
              <FormItem className="flex min-h-0 flex-1 flex-col p-5">
                <FormLabel className="sr-only">分镜脚本</FormLabel>
                <div
                  className="flex min-h-0 flex-1"
                  onDoubleClick={() => {
                    if (!locked) setEditing(true);
                  }}
                >
                  <PromptEditor
                    projectId={projectId}
                    canvasId={canvasId}
                    nodeId={node.id}
                    onReference={(source) => addPromptReference(form, source)}
                    value={field.value}
                    onChange={field.onChange}
                    editable={editing}
                    locked={locked}
                  />
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        {conflict ? (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive">
            <span>分镜已更新，当前脚本已保留。复制需要保留的内容后再载入最新版本。</span>
            <Button variant="outline" size="sm" type="button" onClick={() => form.reset(node)}>
              载入最新
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {matchError ? <p className="text-sm text-destructive">{matchError}</p> : null}
        <p className="text-xs text-muted-foreground">
          {locked ? "任务处理中，当前分镜输入已锁定" : "切换分镜或视图前会保存当前脚本；保存失败时保留编辑内容。"}
        </p>
      </form>
    </Form>
  );
});
