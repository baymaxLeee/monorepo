import { useCallback, useEffect, useRef, useState } from "react";

import { type AssetReviewItem, AssetReviewDialog } from "@/components/AssetReviewDialog/index";
import { resource } from "@/domain";
import { latestAssetReview } from "@/utils/assetReview";
import t from "@/utils/i18n";

import { batchListResourceFiles } from "../domain/actions";

export function ResourceReviewDialog({
  items,
  projectId,
  onClose,
  onSuccess,
}: {
  items: resource.Resource[];
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const loadSequenceRef = useRef(0);
  const [assets, setAssets] = useState<AssetReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!items.length) return;
    const sequence = ++loadSequenceRef.current;
    setLoading(true);
    setError("");
    try {
      const fileGroups = await batchListResourceFiles(
        projectId,
        items.map((item) => item.ResourceID),
      );
      const nextAssets = fileGroups.flatMap((group) =>
        group.Items.flatMap((file) =>
          file.CurrentAssetID
            ? [
                {
                  assetId: file.CurrentAssetID,
                  review: latestAssetReview(file.Reviews),
                },
              ]
            : [],
        ),
      );
      if (sequence !== loadSequenceRef.current) return;
      setAssets(nextAssets);
    } catch (reason) {
      if (sequence !== loadSequenceRef.current) return;
      setError(reason instanceof Error ? reason.message : t("送审信息加载失败，请重试"));
    } finally {
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }, [items, projectId]);

  useEffect(() => {
    setAssets([]);
    setError("");
    if (items.length) void load();
    return () => {
      loadSequenceRef.current += 1;
    };
  }, [items, load]);

  return (
    <AssetReviewDialog
      error={error}
      items={assets}
      loading={loading}
      materialName={items[0]?.Type === resource.ResourceType.AUDIO ? t("音频素材") : t("形象素材")}
      onClose={onClose}
      onPartialSuccess={load}
      onRetry={load}
      onSuccess={() => {
        onSuccess();
        onClose();
      }}
      projectId={projectId}
      visible={Boolean(items.length)}
    />
  );
}
