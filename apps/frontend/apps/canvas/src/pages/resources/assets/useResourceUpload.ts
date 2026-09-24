import { useCallback } from "react";

import type { UploadAssetResult } from "@/hooks/uploads";
import useSilentUploadAsset from "@/hooks/useSilentUploadAsset";
import t from "@/utils/i18n";

export function useResourceUpload() {
  const uploadAsset = useSilentUploadAsset();

  return useCallback(
    async (file: File) => {
      return new Promise<UploadAssetResult>((resolve, reject) => {
        uploadAsset.customRequest({
          file,
          onProgress: () => undefined,
          onSuccess: (response) => {
            const uploaded = response as UploadAssetResult | undefined;
            if (uploaded?.SourceAssetID && uploaded.SourceRevisionID) resolve(uploaded);
            else reject(new Error(t("素材上传失败")));
          },
          onError: (reason) => reject(reason),
        });
      });
    },
    [uploadAsset.customRequest],
  );
}
