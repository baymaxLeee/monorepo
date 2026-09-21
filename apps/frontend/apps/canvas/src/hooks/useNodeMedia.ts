import { canvasNodeContent } from "@repo/api";
import { useEffect, useState } from "react";

export function useNodeMedia(canvasId: string, nodeId: string | undefined, assetId: string | undefined) {
  const [media, setMedia] = useState({ identity: "", url: "", failed: false });
  const identity = nodeId && assetId ? `${canvasId}:${nodeId}:${assetId}` : "";
  useEffect(() => {
    if (!identity || !nodeId) return;
    const controller = new AbortController();
    let url = "";
    void canvasNodeContent(canvasId, nodeId, { signal: controller.signal, skipErrorNotify: true })
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setMedia({ identity, url, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setMedia({ identity, url: "", failed: true });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [canvasId, nodeId, identity]);
  return media.identity === identity ? media : { identity, url: "", failed: false };
}
