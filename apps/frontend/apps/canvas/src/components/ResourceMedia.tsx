import { canvasResourceContent } from "@repo/api";
import { useEffect, useState } from "react";

export function ResourceMedia({
  projectId,
  assetId,
  name,
  type,
}: {
  projectId: string;
  assetId: string;
  name: string;
  type: number;
}) {
  const [url, setURL] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectURL = "";
    setURL("");
    setFailed(false);
    void canvasResourceContent(projectId, assetId, { signal: controller.signal, skipErrorNotify: true })
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
  }, [projectId, assetId]);
  if (!url) return <p className="p-3 text-xs text-muted-foreground">{failed ? "预览加载失败" : "加载预览…"}</p>;
  return type === 3 ? (
    <audio src={url} controls aria-label={name} className="w-full" />
  ) : (
    <img src={url} alt={name} className="max-h-64 w-full object-contain" />
  );
}
