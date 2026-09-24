import { toast } from "@repo/design-system";
import { useCallback } from "react";

import { canvasnode } from "@/domain";
import type { UploadAssetResult } from "@/hooks/uploads";
import useSilentUploadAsset from "@/hooks/useSilentUploadAsset";
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
  const { customRequest } = useSilentUploadAsset();
  const uploadAsset = useCallback(
    (file: File) =>
      new Promise<UploadAssetResult>((resolve, reject) => {
        customRequest({
          file,
          onError: reject,
          onProgress: () => undefined,
          onSuccess: (response) => {
            const uploaded = response as UploadAssetResult | undefined;
            if (uploaded?.SourceAssetID && uploaded.SourceRevisionID) resolve(uploaded);
            else reject(new Error("missing Asset revision"));
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
          const uploaded = await uploadAsset(file);
          const category = categoryFromFile(file);
          const nodeType =
            category === "video"
              ? canvasnode.CanvasNodeType.VIDEO_ASSET
              : category === "audio"
                ? canvasnode.CanvasNodeType.AUDIO_ASSET
                : canvasnode.CanvasNodeType.IMAGE_ASSET;
          await createNode(nodeType, {
            position: position ? { x: position.x + index * 28, y: position.y + index * 28 } : undefined,
            uploadedAsset: {
              SourceAssetID: uploaded.SourceAssetID,
              SourceRevisionID: uploaded.SourceRevisionID,
              FileName: file.name,
            },
          });
        }
      } catch {
        toast.add({
          type: "error",
          title: t("上传素材失败，请重试"),
        });
      }
    },
    [createNode, uploadAsset],
  );

  return uploadFiles;
}
