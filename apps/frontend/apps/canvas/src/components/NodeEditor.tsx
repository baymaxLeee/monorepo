import type { CanvasNode } from "@repo/api";
import { Button, Form, FormField, FormItem, FormControl, FormLabel, Input, Textarea } from "@repo/design-system";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { useForm } from "react-hook-form";

import { GenerationSettings } from "./GenerationSettings";
export interface NodeEditorHandle {
  finish: () => Promise<void>;
}
export const NodeEditor = forwardRef<
  NodeEditorHandle,
  {
    node: CanvasNode;
    busy: boolean;
    onSave: (node: CanvasNode) => Promise<void>;
    onDelete: () => void;
  }
>(function NodeEditor({ node, busy, onSave, onDelete }, ref) {
  const form = useForm({ defaultValues: node });
  const dirty = form.formState.isDirty;
  const revision = form.watch("revision");
  const conflict = revision !== node.revision;
  useEffect(() => {
    if (!dirty) form.reset(node);
  }, [node, dirty, form]);
  useImperativeHandle(
    ref,
    () => ({
      async finish() {
        if (!form.formState.isDirty) return;
        if (busy || conflict || !(await form.trigger())) throw new Error("请先处理节点编辑冲突或校验错误");
        const value = form.getValues();
        await onSave(value);
        form.reset(value);
      },
    }),
    [form, busy, conflict, onSave],
  );
  return (
    <Form {...form}>
      <form
        className="space-y-4 border-b p-4"
        onSubmit={form.handleSubmit(async (value) => {
          try {
            await onSave(value);
            form.reset(value);
          } catch {
            /* Preserve unsaved form values after a conflict. */
          }
        })}
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>节点名称</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        {node.type >= 4 ? (
          <FormField
            control={form.control}
            name={node.type === 4 ? "text" : "prompt"}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{node.type === 4 ? "文本" : "提示词"}</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={6} />
                </FormControl>
              </FormItem>
            )}
          />
        ) : null}
        {node.type >= 5 ? <GenerationSettings form={form} type={node.type} disabled={busy} /> : null}
        {conflict && dirty ? (
          <div className="space-y-2 text-sm" role="alert">
            <p>节点已被其他操作更新，当前草稿尚未保存。请先复制需要保留的内容，再载入最新版本。</p>
            <Button type="button" variant="outline" onClick={() => form.reset(node)}>
              载入最新版本
            </Button>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button disabled={busy || conflict} type="submit">
            保存
          </Button>
          <Button disabled={busy} variant="outline" type="button" onClick={onDelete}>
            删除节点
          </Button>
        </div>
      </form>
    </Form>
  );
});
