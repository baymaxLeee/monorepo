import { authFetch } from "@repo/api";
import { canvasPrepareUpload } from "@repo/api/canvas";
import { randomId } from "@repo/shared";

export interface UploadAssetResult {
  SourceAssetID: string;
  SourceRevisionID: string;
  Filename: string;
  file?: File;
}
export interface UploadOptions {
  file: File;
  onProgress: (percent: number, event?: ProgressEvent) => void;
  onSuccess: (response?: object) => void;
  onError: (response?: object) => void;
}
export interface UseUploadAsset {
  customRequest: (options: UploadOptions) => { abort: () => void };
  abortUploadFile: (file: File) => void;
  abortUploadAllFiles: () => void;
}
export function stageUpload(options: UploadOptions) {
  const controller = new AbortController();
  const clientRef = randomId();
  const request = {
    client_ref: clientRef,
    purpose: "source",
    filename: options.file.name,
    media_type: options.file.type || "application/octet-stream",
    size_bytes: options.file.size,
  };
  void canvasPrepareUpload(request)
    .then(async (plan) => {
      const response = await authFetch(plan.upload_url, {
        method: "PUT",
        headers: { "Content-Type": request.media_type },
        body: options.file,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`upload failed: ${response.status}`);
      const completed = await canvasPrepareUpload(request);
      if (!completed.asset_id || !completed.revision_id) throw new Error("completed upload is missing its revision");
      return { assetId: completed.asset_id, revisionId: completed.revision_id };
    })
    .then((result) => {
      options.onProgress(100);
      options.onSuccess({
        SourceAssetID: result.assetId,
        SourceRevisionID: result.revisionId,
        Filename: options.file.name,
        file: options.file,
      } satisfies UploadAssetResult);
    })
    .catch((error: unknown) => {
      options.onError(error instanceof Error ? error : new Error(String(error)));
    });
  return {
    abort: () => {
      if (controller.signal.aborted) return;
      controller.abort();
    },
  };
}
