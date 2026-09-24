import { useEffect, useMemo, useRef } from "react";

import { stageUpload, type UseUploadAsset } from "./uploads";

export default function useSilentUploadAsset(): UseUploadAsset {
  const pending = useRef(new Map<File, () => void>());
  const api = useMemo<UseUploadAsset>(
    () => ({
      customRequest(options) {
        pending.current.get(options.file)?.();
        const staged = stageUpload(options);
        const abort = () => {
          staged.abort();
          pending.current.delete(options.file);
        };
        pending.current.set(options.file, abort);
        return { abort };
      },
      abortUploadFile(file) {
        pending.current.get(file)?.();
      },
      abortUploadAllFiles() {
        for (const abort of pending.current.values()) abort();
        pending.current.clear();
      },
    }),
    [],
  );
  useEffect(() => () => api.abortUploadAllFiles(), [api]);
  return api;
}
