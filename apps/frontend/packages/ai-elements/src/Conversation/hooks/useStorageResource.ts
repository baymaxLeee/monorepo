import {
  AssetDownloadError,
  type StorageDownloadCapability,
  type StorageDeliveryRef,
  createStorageDownloadUrl,
  fetchAssetText,
} from "@repo/api";
import { useCallback, useEffect, useState } from "react";

type ResourceState = {
  key: string;
  capability?: StorageDownloadCapability;
  content?: string;
  error?: string;
  loading: boolean;
};

/** One active preview owns its request and body; capability renewal never enters message state. */
export function useStorageResource(asset: StorageDeliveryRef | undefined, readText: boolean) {
  const key = asset ? `${asset.assetId}:${asset.revisionId}:${JSON.stringify(asset.owner)}:${readText}` : "";
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ResourceState>({ key: "", loading: false });
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!asset) return;
    const controller = new AbortController();
    let renewal: ReturnType<typeof setTimeout> | undefined;
    let expiresAt = Infinity;
    const resume = () => {
      if (!document.hidden && Date.now() >= expiresAt - 30_000) retry();
    };
    document.addEventListener("visibilitychange", resume);
    setState((previous) =>
      previous.key === key && previous.capability ? { ...previous, error: undefined } : { key, loading: true },
    );
    async function load() {
      try {
        let capability = await createStorageDownloadUrl(asset!, controller.signal);
        let content: string | undefined;
        if (readText) {
          try {
            content = await fetchAssetText(capability.url, controller.signal);
          } catch (error) {
            // A cached capability can expire between signing and byte delivery. Retry once.
            if (!(error instanceof AssetDownloadError) || ![401, 403].includes(error.status)) throw error;
            capability = await createStorageDownloadUrl(asset!, controller.signal);
            content = await fetchAssetText(capability.url, controller.signal);
          }
        }
        if (controller.signal.aborted) return;
        setState({ key, capability, content, loading: false });
        if (!readText) {
          expiresAt = Date.parse(capability.expires_at);
          // Native players/iframes cannot attach auth headers. Renew before their next Range request expires.
          renewal = setTimeout(retry, Math.max(1000, Date.parse(capability.expires_at) - Date.now() - 30_000));
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setState({ key, loading: false, error: error instanceof Error ? error.message : "无法加载预览" });
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(renewal);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [asset?.assetId, asset?.revisionId, readText, key, attempt, retry]);

  const current = state.key === key ? state : { key, loading: Boolean(asset) };
  const onResourceError = () => {
    if (current.capability && Date.parse(current.capability.expires_at) <= Date.now()) retry();
    else setState((previous) => ({ ...previous, loading: false, error: "无法读取文件" }));
  };
  return { ...current, retry, onResourceError };
}
