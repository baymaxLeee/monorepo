import { canvasNodeContent, canvasGenerationContent } from "@repo/api";
import { useEffect, useState } from "react";

export function MediaPreview({
  canvasId,
  nodeId,
  generationId,
  type,
  name,
}: {
  canvasId: string;
  nodeId: string;
  generationId?: string;
  type: number;
  name: string;
}) {
  const [url, setURL] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectURL = "";
    setURL("");
    setFailed(false);
    void (
      generationId
        ? canvasGenerationContent(canvasId, generationId, { signal: controller.signal, skipErrorNotify: true })
        : canvasNodeContent(canvasId, nodeId, { signal: controller.signal, skipErrorNotify: true })
    )
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectURL = URL.createObjectURL(blob);
        setURL(objectURL);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [canvasId, nodeId, generationId]);
  if (!url) return <p className="p-4 text-sm text-muted-foreground">{failed ? "素材加载失败" : "加载素材…"}</p>;
  if (type === 1 || type === 5)
    return <img src={url} alt={name} className="max-h-80 w-full rounded-b-xl object-contain" />;
  if (type === 2 || type === 6)
    return <video src={url} controls className="nodrag nopan w-full rounded-b-xl" aria-label={name} />;
  return <audio src={url} controls className="nodrag nopan w-full" aria-label={name} />;
}
