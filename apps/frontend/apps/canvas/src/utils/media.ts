import { canvasNodeContent, canvasResourceContent, canvasGenerationContent } from "@repo/api";

const urls = new Map<string, Promise<string>>();
const controllers = new Set<AbortController>();
let epoch = 0;
export function mediaURL(key: string, read: (signal: AbortSignal) => Promise<Blob>) {
  let promise = urls.get(key);
  if (!promise) {
    const controller = new AbortController();
    const generation = epoch;
    controllers.add(controller);
    promise = read(controller.signal)
      .then((blob) => {
        if (generation !== epoch) throw new DOMException("页面已离开", "AbortError");
        return URL.createObjectURL(blob);
      })
      .catch((error: unknown) => {
        urls.delete(key);
        throw error;
      })
      .finally(() => controllers.delete(controller));
    urls.set(key, promise);
  }
  return promise;
}
export function releaseMediaURLs() {
  epoch += 1;
  for (const controller of controllers) controller.abort();
  for (const promise of urls.values())
    void promise.then(
      (url) => URL.revokeObjectURL(url),
      () => undefined,
    );
  urls.clear();
}
export const nodeMediaURL = (canvasId: string, nodeId: string, assetId: string) =>
  mediaURL(`node:${canvasId}:${nodeId}:${assetId}`, (signal) =>
    canvasNodeContent(canvasId, nodeId, { signal, skipErrorNotify: true }),
  );
export const resourceMediaURL = (projectId: string, resourceAssetId: string, assetId: string) =>
  mediaURL(`resource:${projectId}:${resourceAssetId}:${assetId}`, (signal) =>
    canvasResourceContent(projectId, resourceAssetId, { signal, skipErrorNotify: true }),
  );
export const generationMediaURL = (canvasId: string, runId: string) =>
  mediaURL(`run:${canvasId}:${runId}`, (signal) =>
    canvasGenerationContent(canvasId, runId, { signal, skipErrorNotify: true }),
  );
