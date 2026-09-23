export interface UploadBlobResult {
  BlobID: string;
  Filename: string;
  file?: File;
}
export interface UploadOptions {
  file: File;
  onProgress: (percent: number, event?: ProgressEvent) => void;
  onSuccess: (response?: object) => void;
  onError: (response?: object) => void;
}
export interface UseUploadBlob {
  customRequest: (options: UploadOptions) => { abort: () => void };
  abortUploadFile: (file: File) => void;
  abortUploadAllFiles: () => void;
}
export function stageUpload(options: UploadOptions) {
  const controller = new AbortController();
  void stageCanvasUpload(options.file, controller.signal)
    .then((result) => {
      options.onProgress(100);
      options.onSuccess({
        BlobID: result.blob_id,
        Filename: options.file.name,
        file: options.file,
      } satisfies UploadBlobResult);
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
import { stageCanvasUpload } from "@repo/api";
