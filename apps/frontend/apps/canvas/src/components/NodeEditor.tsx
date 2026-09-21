import type { CanvasNode } from "@repo/api";
import { Button, Form, FormField, FormItem, FormControl, FormLabel, Input, Textarea } from "@repo/design-system";
import { useStore } from "jotai";
import { LoaderCircle, Sparkles } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { useForm } from "react-hook-form";

import { useAssetMatching } from "../hooks/useAssetMatching";
import { canvasGraphAtom } from "../store/graph";
import { GenerationSettings } from "./GenerationSettings";
import { NodeAssetActions } from "./NodeAssetActions";
import { AssetStrip } from "./prompt/AssetStrip";
import { PromptEditor } from "./prompt/PromptEditor";
import { addPromptReference } from "./prompt/references";
export interface NodeEditorHandle {
  finish: () => Promise<void>;
}
export const NodeEditor = forwardRef<
  NodeEditorHandle,
  {
    node: CanvasNode;
    projectId: string;
    canvasId: string;
    busy: boolean;
    onSave: (node: CanvasNode) => Promise<void>;
    onRefresh: () => Promise<void>;
    onDelete: () => void;
    onSelect: (id: string) => void;
  }
>(function NodeEditor({ node, projectId, canvasId, busy, onSave, onRefresh, onDelete, onSelect }, ref) {
  const store = useStore();
  const form = useForm({ defaultValues: node });
  const dirty = form.formState.isDirty;
  const revision = form.watch("revision");
  const conflict = revision !== node.revision;
  const matching = useAssetMatching({ canvasId, nodeId: node.id, onApplied: onRefresh });
  const locked = busy || matching.matching;
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
                <Input {...field} disabled={locked} />
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
                  <div className="flex h-60 flex-col">
                    {node.type === 4 ? (
                      <Textarea {...field} rows={6} disabled={locked} />
                    ) : (
                      <PromptEditor
                        projectId={projectId}
                        canvasId={canvasId}
                        value={field.value}
                        onChange={field.onChange}
                        nodeId={node.id}
                        onReference={(source) => addPromptReference(form, source)}
                        editable={!locked}
                        locked={matching.matching}
                      />
                    )}
                  </div>
                </FormControl>
              </FormItem>
            )}
          />
        ) : null}
        {node.type === 5 || node.type === 6 ? (
          <AssetStrip form={form} disabled={locked} projectId={projectId} canvasId={canvasId} />
        ) : null}
        <NodeAssetActions node={node} disabled={locked || dirty} onCopied={onSelect} />
        {[5, 6].includes(node.type) && node.video_input_mode !== 2 ? (
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || conflict || matching.cancelling || (!matching.matching && !form.watch("prompt").trim())}
              onClick={() => {
                if (matching.matching) void matching.cancel();
                else
                  void matching.start(async () => {
                    if (form.formState.isDirty) {
                      if (!(await form.trigger())) throw new Error("请先修正提示词");
                      await onSave(form.getValues());
                    }
                    return (
                      store.get(canvasGraphAtom)?.nodes.find((item) => item.id === node.id)?.revision ?? node.revision
                    );
                  });
              }}
            >
              {matching.matching ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {matching.matching ? (matching.cancelling ? "取消中…" : "取消素材匹配") : "素材智能匹配"}
            </Button>
            {matching.error ? <p className="text-sm text-destructive">{matching.error}</p> : null}
          </div>
        ) : null}
        {node.type >= 5 ? <GenerationSettings form={form} type={node.type} disabled={locked} /> : null}
        {conflict && dirty ? (
          <div className="space-y-2 text-sm" role="alert">
            <p>节点已被其他操作更新，当前草稿尚未保存。请先复制需要保留的内容，再载入最新版本。</p>
            <Button type="button" variant="outline" onClick={() => form.reset(node)}>
              载入最新版本
            </Button>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button disabled={locked || conflict} type="submit">
            保存
          </Button>
          <Button disabled={locked} variant="outline" type="button" onClick={onDelete}>
            删除节点
          </Button>
        </div>
      </form>
    </Form>
  );
});
