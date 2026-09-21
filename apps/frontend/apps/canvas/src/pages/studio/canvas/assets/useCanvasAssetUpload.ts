import { useCallback } from "react";

import { Message } from "@/components/ui";
import { canvasnode } from "@/domain";
import type { UploadBlobResult } from "@/hooks/uploads";
import useSilentUploadBlob from "@/hooks/useSilentUploadBlob";
import t from "@/utils/i18n";

import { categoryFromFile } from "../../domain/model";

export function useCanvasAssetUpload({
  createNode,
}: {
  createNode: (
    type: canvasnode.CanvasNodeType,
    options: {
      position?: { x: number; y: number };
      uploadedAsset: canvasnode.CanvasUploadedAsset;
    },
  ) => Promise<canvasnode.CanvasNode | undefined>;
}) {
  const { customRequest } = useSilentUploadBlob();
  const uploadBlob = useCallback(
    (file: File) =>
      new Promise<string>((resolve, reject) => {
        customRequest({
          file,
          onError: reject,
          onProgress: () => undefined,
          onSuccess: (response) => {
            const blobID = (response as UploadBlobResult | undefined)?.BlobID;
            if (blobID) resolve(blobID);
            else reject(new Error("missing BlobID"));
          },
        });
      }),
    [customRequest],
  );

  const uploadFiles = useCallback(
    async (files: File[], position?: { x: number; y: number }) => {
      if (!files.length) return;
      try {
        for (const [index, file] of files.entries()) {
          const blobID = await uploadBlob(file);
          const category = categoryFromFile(file);
          const nodeType =
            category === "video"
              ? canvasnode.CanvasNodeType.VIDEO_ASSET
              : category === "audio"
                ? canvasnode.CanvasNodeType.AUDIO_ASSET
                : canvasnode.CanvasNodeType.IMAGE_ASSET;
          await createNode(nodeType, {
            position: position ? { x: position.x + index * 28, y: position.y + index * 28 } : undefined,
            uploadedAsset: { BlobID: blobID, FileName: file.name },
          });
        }
      } catch {
        Message.error(t("上传素材失败，请重试"));
      }
    },
    [createNode, uploadBlob],
  );

  return uploadFiles;
}
