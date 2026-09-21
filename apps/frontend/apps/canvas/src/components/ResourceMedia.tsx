import { canvasResourceContent, canvasResourceVersionContent } from "@repo/api";
import { cn } from "@repo/shared";
import { useEffect, useState } from "react";

export function ResourceMedia({
  projectId,
  assetId,
  name,
  type,
  revision,
  className,
  compact = false,
}: {
  projectId: string;
  assetId: string;
  name: string;
  type: number;
  revision?: number;
  className?: string;
  compact?: boolean;
}) {
  const [url, setURL] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectURL = "";
    setURL("");
    setFailed(false);
    const options = { signal: controller.signal, skipErrorNotify: true };
    const request = revision
      ? canvasResourceVersionContent(projectId, assetId, String(revision), options)
      : canvasResourceContent(projectId, assetId, options);
    void request
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
  }, [projectId, assetId, revision]);
  if (!url)
    return (
      <div className={cn("flex h-full min-h-24 items-center justify-center text-xs text-muted-foreground", className)}>
        {failed ? "预览加载失败" : "加载预览…"}
      </div>
    );
  return type === 3 ? (
    <audio src={url} controls aria-label={name} className={cn("w-full", className)} />
  ) : (
    <img
      src={url}
      alt={name}
      className={cn(compact ? "h-full w-full object-cover" : "max-h-64 w-full object-contain", className)}
    />
  );
}
