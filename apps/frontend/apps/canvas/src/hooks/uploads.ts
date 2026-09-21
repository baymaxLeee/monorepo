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
// The destination-specific Canvas upload endpoints own persistence. A local
// selection token never becomes a server asset ID or a persisted object key.
const selections = new Map<
  string,
  { file: File; controller: AbortController; progress: UploadOptions["onProgress"] }
>();
export function stageUpload(options: UploadOptions) {
  const id = `selection:${crypto.randomUUID()}`;
  const controller = new AbortController();
  let delivered = false;
  selections.set(id, { file: options.file, controller, progress: options.onProgress });
  queueMicrotask(() => {
    if (controller.signal.aborted) return;
    delivered = true;
    options.onSuccess({ BlobID: id, Filename: options.file.name, file: options.file } satisfies UploadBlobResult);
  });
  return {
    id,
    abort: () => {
      if (controller.signal.aborted) return;
      controller.abort();
      selections.delete(id);
      if (!delivered) options.onError(new DOMException("上传已取消", "AbortError"));
    },
  };
}
export function selectedUpload(id: string) {
  const selection = selections.get(id);
  if (!selection || selection.controller.signal.aborted) throw new Error("所选文件已取消，请重新选择");
  return selection;
}
export function completeUpload(id: string) {
  selections.delete(id);
}
