import { useCallback } from "react";

import type { UploadBlobResult } from "@/hooks/uploads";
import useSilentUploadBlob from "@/hooks/useSilentUploadBlob";
import t from "@/utils/i18n";

export function useResourceUpload() {
  const uploadBlob = useSilentUploadBlob();

  return useCallback(
    async (file: File) => {
      return new Promise<string>((resolve, reject) => {
        uploadBlob.customRequest({
          file,
          onProgress: () => undefined,
          onSuccess: (response) => {
            const blobId = (response as UploadBlobResult | undefined)?.BlobID;
            if (blobId) resolve(blobId);
            else reject(new Error(t("素材上传失败")));
          },
          onError: (reason) => reject(reason),
        });
      });
    },
    [uploadBlob.customRequest],
  );
}
