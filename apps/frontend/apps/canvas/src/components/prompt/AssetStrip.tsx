import type { CanvasNode } from "@repo/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Input,
  toast,
} from "@repo/design-system";
import { useAtomValue } from "jotai";
import { FileText, Image, Music, Plus, Upload, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";

import { type CreativeAssetItem, useCreativeAssets } from "../../hooks/useCreativeAssets";
import { useNodeMedia } from "../../hooks/useNodeMedia";
import { canvasGraphAtom } from "../../store/graph";
import { MediaPreview } from "../MediaPreview";
import { FrameReferences } from "./FrameReferences";
import { addPromptReference } from "./references";

function Thumbnail({ canvasId, node }: { canvasId: string; node: CanvasNode }) {
  const image = [1, 5].includes(node.type);
  const media = useNodeMedia(canvasId, image ? node.id : undefined, node.asset_id);
  const Icon = image ? Image : [2, 6].includes(node.type) ? Video : node.type === 3 ? Music : FileText;
  return media.url ? (
    <img src={media.url} alt={node.name} className="size-full object-cover" />
  ) : (
    <Icon className="size-10 text-muted-foreground" />
  );
}

export function AssetStrip({
  form,
  disabled,
  projectId,
  canvasId,
}: {
  form: UseFormReturn<CanvasNode>;
  disabled: boolean;
  projectId: string;
  canvasId: string;
}) {
  const graph = useAtomValue(canvasGraphAtom);
  const { search, materialize, materializeFrame, upload } = useCreativeAssets(projectId, canvasId);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<CanvasNode | null>(null);
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<CreativeAssetItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const edges = form.watch("incoming_edges");
  const nodeId = form.watch("id");
  const type = form.watch("type");
  const frameMode = form.watch("video_input_mode") === 2;
  const linked = new Set(edges.map((edge) => edge.source_node_id));
  const assets = graph?.nodes.filter((node) => linked.has(node.id)) ?? [];
  useEffect(() => {
    if (!open) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      setSearching(true);
      setSearchFailed(false);
      void search(query, (candidateType) =>
        frameMode
          ? [1, 2, 5, 6].includes(candidateType)
          : type === 5
            ? [1, 5].includes(candidateType)
            : [1, 2, 3, 4, 5, 6, 7].includes(candidateType),
      )
        .then((items) => {
          if (active)
            setCandidates(items.filter((item) => item.node?.id !== nodeId && !linked.has(item.node?.id ?? "")));
        })
        .catch(() => {
          if (active) setSearchFailed(true);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [edges, frameMode, nodeId, open, query, search, type]);
  function remove(id: string) {
    form.setValue(
      "incoming_edges",
      edges.filter((edge) => edge.source_node_id !== id),
      { shouldDirty: true },
    );
    const container = document.createElement("div");
    // Parse only for identifying mention spans; preserve all other Markdown bytes.
    const prompt = form
      .getValues("prompt")
      .replace(/<span\b[^>]*data-type=["']mention["'][^>]*>(?:[^<]|<\/(?!span>))*<\/span>/gi, (markup) => {
        container.innerHTML = markup;
        return container.firstElementChild?.getAttribute("data-id") === id ? "" : markup;
      });
    form.setValue("prompt", prompt, { shouldDirty: true });
  }
  function setFrame(node: CanvasNode, port?: "FIRST_FRAME" | "LAST_FRAME") {
    const targetPort =
      port ?? (edges.some((edge) => edge.target_port === "FIRST_FRAME") ? "LAST_FRAME" : "FIRST_FRAME");
    form.setValue(
      "incoming_edges",
      [
        ...edges.filter((edge) => edge.target_port !== targetPort),
        {
          id: crypto.randomUUID(),
          source_node_id: node.id,
          source_port: "OUTPUT",
          target_port: targetPort,
          target_order: 0,
        },
      ],
      { shouldDirty: true },
    );
    setOpen(false);
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>参考素材 · {assets.length}</span>
        <span>输入 @ 引用素材</span>
      </div>
      {frameMode ? <FrameReferences form={form} disabled={disabled} /> : null}
      <div className="flex min-h-[54px] items-center gap-3 overflow-x-auto pb-1">
        {assets.map((asset) => (
          <div key={asset.id} className="group relative size-[54px] shrink-0 overflow-hidden rounded-xl bg-muted">
            <button
              type="button"
              className="flex size-full items-center justify-center"
              title={asset.name}
              onClick={() => setPreview(asset)}
            >
              <Thumbnail canvasId={graph!.canvas.id} node={asset} />
            </button>
            {!disabled ? (
              <button
                type="button"
                aria-label={`移除${asset.name}`}
                className="absolute right-[5px] top-[5px] hidden size-4 items-center justify-center rounded-full bg-black/50 text-white group-hover:flex focus-visible:flex"
                onClick={() => remove(asset.id)}
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="size-[54px] shrink-0 rounded-xl border-dashed"
              aria-label="添加参考素材"
            >
              <Plus className="size-6" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <input
              ref={uploadInput}
              type="file"
              className="hidden"
              accept={frameMode || type === 5 ? "image/*" : "image/*,video/*,audio/*"}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setUploading(true);
                void upload(file)
                  .then((node) => {
                    if (frameMode) setFrame(node);
                    else {
                      addPromptReference(form, node);
                      setOpen(false);
                    }
                  })
                  .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : "素材上传失败"))
                  .finally(() => setUploading(false));
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="mb-2 w-full"
              disabled={uploading}
              onClick={() => uploadInput.current?.click()}
            >
              <Upload className="size-4" />
              {uploading ? "上传中…" : frameMode ? "上传帧图片" : "从本地上传"}
            </Button>
            <Input
              aria-label="搜索参考素材"
              placeholder="搜索画布与项目素材"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="mt-2 max-h-60 overflow-y-auto">
              {candidates.map((candidate) => (
                <div key={candidate.id} className="flex items-center rounded-md hover:bg-accent">
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-w-0 flex-1 justify-start truncate hover:bg-transparent"
                    disabled={frameMode && [2, 6].includes(candidate.type)}
                    onClick={() =>
                      void materialize(candidate)
                        .then((node) => {
                          if (frameMode) setFrame(node);
                          else {
                            addPromptReference(form, node);
                            setOpen(false);
                          }
                        })
                        .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : "素材选用失败"))
                    }
                  >
                    <span className="min-w-0 flex-1 truncate text-left">{candidate.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {candidate.source === "library" ? "资源库" : "画布"}
                    </span>
                  </Button>
                  {frameMode && [2, 6].includes(candidate.type) ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void materializeFrame(candidate, "first")
                            .then((node) => setFrame(node, "FIRST_FRAME"))
                            .catch((cause: unknown) =>
                              toast.error(cause instanceof Error ? cause.message : "首帧读取失败"),
                            )
                        }
                      >
                        首帧
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void materializeFrame(candidate, "last")
                            .then((node) => setFrame(node, "LAST_FRAME"))
                            .catch((cause: unknown) =>
                              toast.error(cause instanceof Error ? cause.message : "尾帧读取失败"),
                            )
                        }
                      >
                        尾帧
                      </Button>
                    </>
                  ) : null}
                </div>
              ))}
              {!candidates.length && !searching ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {searchFailed ? "素材搜索失败，请重试" : "未找到可引用素材"}
                </p>
              ) : null}
              {searching ? <p className="py-4 text-center text-sm text-muted-foreground">搜索中…</p> : null}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(next) => {
          if (!next) setPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{preview?.name}</DialogTitle>
          </DialogHeader>
          {preview && graph ? (
            <MediaPreview canvasId={graph.canvas.id} nodeId={preview.id} name={preview.name} type={preview.type} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
