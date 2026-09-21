import { canvasCopyNode, canvasResourceFromNode, type CanvasNode } from "@repo/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  toast,
} from "@repo/design-system";
import { useStore } from "jotai";
import { Copy, Library } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { applyGraphAtom, canvasGraphAtom } from "../store/graph";
import { useStudioMutationCoordinator } from "../store/mutations";

export function NodeAssetActions({ node, disabled }: { node: CanvasNode; disabled: boolean }) {
  const store = useStore();
  const coordinator = useStudioMutationCoordinator();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const resourceId = useRef(crypto.randomUUID());
  const form = useForm({ defaultValues: { name: node.name, type: node.type === 3 ? "4" : "1", description: "" } });
  async function copy() {
    setBusy(true);
    try {
      await coordinator.enqueue(async () => {
        const graph = store.get(canvasGraphAtom);
        if (!graph) return;
        const result = await canvasCopyNode(graph.canvas.id, node.id, {
          node_id: crypto.randomUUID(),
          expected_revision: graph.canvas.revision,
        });
        store.set(applyGraphAtom, result);
      });
    } catch {
    } finally {
      setBusy(false);
    }
  }
  const canAdd = Boolean(node.asset_id) && [1, 3, 5].includes(node.type);
  return (
    <>
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => void copy()}>
          <Copy className="size-4" />
          复制节点
        </Button>
        {canAdd ? (
          <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => setOpen(true)}>
            <Library className="size-4" />
            加入资源库
          </Button>
        ) : null}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>加入项目资源库</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form
              className="space-y-4"
              onSubmit={form.handleSubmit(async (values) => {
                const graph = store.get(canvasGraphAtom);
                if (!graph) return;
                setBusy(true);
                try {
                  await canvasResourceFromNode(graph.canvas.id, node.id, {
                    resource_id: resourceId.current,
                    name: values.name,
                    description: values.description,
                    type: Number(values.type),
                  });
                  toast.success("已加入项目资源库");
                  resourceId.current = crypto.randomUUID();
                  window.dispatchEvent(new Event("canvas:resources-changed"));
                  setOpen(false);
                } catch {
                } finally {
                  setBusy(false);
                }
              })}
            >
              <FormField
                control={form.control}
                name="name"
                rules={{ required: true, maxLength: 50 }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>名称</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>描述</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>分类</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(node.type === 3
                          ? [["4", "音频"]]
                          : [
                              ["1", "角色"],
                              ["2", "场景"],
                              ["3", "道具"],
                            ]
                        ).map(([value, label]) => (
                          <SelectItem key={value} value={value!}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <Button disabled={busy} type="submit">
                加入资源库
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
