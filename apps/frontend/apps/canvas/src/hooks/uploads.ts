import { executeAssetUploadPlan, prepareCanvasUpload } from "@repo/api";

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
  const clientRef = crypto.randomUUID();
  void prepareCanvasUpload({ clientRef, purpose: "source", file: options.file })
    .then(async (plan) => {
      await executeAssetUploadPlan(plan, options.file, controller.signal);
      const completed = await prepareCanvasUpload({ clientRef, purpose: "source", file: options.file });
      if (!completed.assetId || !completed.revisionId) throw new Error("completed upload is missing its revision");
      return { assetId: completed.assetId, revisionId: completed.revisionId };
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
