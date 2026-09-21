import { canvasUpdateStoryboard, type CanvasStoryboardDraft, type CanvasStoryboardShot } from "@repo/api";
import { Button, Form, FormControl, FormField, FormItem, FormMessage, Input, Textarea } from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import type { NodeEditorHandle } from "../NodeEditor";

export const StoryboardDraftEditor = forwardRef<
  NodeEditorHandle,
  {
    canvasId: string;
    draft: CanvasStoryboardDraft;
    busy: boolean;
    onConfirm: (shots: CanvasStoryboardShot[]) => Promise<void>;
  }
>(function StoryboardDraftEditor({ canvasId, draft, busy, onConfirm }, ref) {
  const form = useForm<{ shots: CanvasStoryboardShot[] }>({ defaultValues: { shots: draft.shots } });
  const dirty = form.formState.isDirty;
  const [revision, setRevision] = useState(draft.revision);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef<Promise<void> | null>(null);
  const completed = draft.status === "completed" && !draft.cancel_requested;
  useEffect(() => {
    if (!dirty && draft.revision >= revision) {
      form.reset({ shots: draft.shots });
      setRevision(draft.revision);
    }
  }, [draft, dirty, revision, form]);
  function finish() {
    if (pending.current) return pending.current;
    const task = (async () => {
      if (!form.formState.isDirty) return;
      if (!completed || !(await form.trigger())) throw new Error("请检查候选分镜脚本与时长");
      setSaving(true);
      try {
        const saved = await canvasUpdateStoryboard(
          canvasId,
          draft.id,
          { expected_revision: revision, shots: form.getValues().shots, video_config: draft.video_config },
          { skipErrorNotify: true },
        );
        form.reset({ shots: saved.shots });
        setRevision(saved.revision);
        setError("");
      } finally {
        setSaving(false);
      }
    })();
    pending.current = task;
    void task
      .catch((cause: unknown) => setError(getErrorMessage(cause, "保存失败，候选分镜编辑已保留")))
      .finally(() => {
        pending.current = null;
      });
    return task;
  }
  useImperativeHandle(ref, () => ({ finish }));
  const shots = form.watch("shots");
  return (
    <Form {...form}>
      <form
        className="flex min-h-0 flex-1 flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void finish().catch(() => {});
        }}
      >
        <p className="text-sm text-muted-foreground">
          {completed ? "共" : "已生成"} {shots.length} 个分镜，预计{" "}
          {shots.reduce((sum, shot) => sum + shot.duration_seconds, 0)} 秒
          {completed ? "，可编辑后确认加入画布" : "，其余分镜继续生成中…"}
        </p>
        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-2">
          {shots.map((shot, index) => (
            <section key={shot.id} className="space-y-3 rounded-xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">分镜 {shot.sequence_no || index + 1}</h3>
                <FormField
                  control={form.control}
                  name={`shots.${index}.duration_seconds`}
                  rules={{
                    min: { value: 4, message: "最少 4 秒" },
                    max: { value: 30, message: "最多 30 秒" },
                    validate: (value) => Number.isInteger(value) || "请输入整数秒",
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          type="number"
                          className="h-8 w-24"
                          aria-label={`分镜 ${index + 1} 时长（秒）`}
                          min={4}
                          max={30}
                          value={field.value}
                          disabled={busy || saving || !completed}
                          onChange={(event) => field.onChange(Number(event.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name={`shots.${index}.prompt`}
                rules={{
                  validate: (value) =>
                    (Boolean(value.trim()) && [...value].length <= 30000) || "脚本不能为空且最多 30000 字",
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={8}
                        className="resize-y border-0 bg-muted/30 leading-7 shadow-none"
                        aria-label={`分镜 ${index + 1} 脚本`}
                        disabled={busy || saving || !completed}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {completed ? (
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="outline" type="submit" disabled={busy || saving || !dirty}>
              {saving ? "保存中…" : "保存草稿"}
            </Button>
            <Button
              type="button"
              disabled={busy || saving || !shots.length}
              onClick={() => {
                void (async () => {
                  await finish();
                  await onConfirm(form.getValues().shots);
                })().catch(() => {});
              }}
            >
              确认全部分镜并加入画布
            </Button>
          </div>
        ) : null}
      </form>
    </Form>
  );
});
