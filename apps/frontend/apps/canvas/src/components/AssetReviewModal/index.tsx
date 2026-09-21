import { useEffect, useRef, useState } from "react";

import { batchSubmitAssetReviews, listAvailableBenefitPackages } from "@/api/assetReviews";
import { agentframeService } from "@/api/index";
import { Button, Message, Spin, Checkbox, Modal } from "@/components/ui";
import type { asset, benefit_package } from "@/domain";
import t from "@/utils/i18n";

import modalSizing from "@/components/ModalSizing.module.less";

export interface AssetReviewItem {
  assetId?: string;
  review?: asset.AssetReview;
  upload?: asset.AssetReviewUpload;
}

export interface AssetReviewModalProps {
  error?: string;
  items: AssetReviewItem[];
  loading?: boolean;
  materialName?: string;
  projectId: string;
  visible: boolean;
  onClose: () => void;
  onPartialSuccess?: (results: asset.SubmitAssetReviewResponse[]) => Promise<void> | void;
  onRetry?: () => void;
  onSuccess: (results: asset.SubmitAssetReviewResponse[]) => Promise<void> | void;
  zIndex?: number;
}

export function AssetReviewModal({
  error,
  items,
  loading = false,
  materialName = t("形象素材"),
  projectId,
  visible,
  onClose,
  onPartialSuccess,
  onRetry,
  onSuccess,
  zIndex,
}: AssetReviewModalProps) {
  const loadSequenceRef = useRef(0);
  const [packages, setPackages] = useState<benefit_package.BenefitPackage[]>([]);
  const [selectedPackageIds, setSelectedPackageIds] = useState<string[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [packagesError, setPackagesError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submissions = items;
  const busy = loading || packagesLoading || submitting;
  const loadError = error || packagesError;

  const loadPackages = async () => {
    const sequence = ++loadSequenceRef.current;
    setPackagesLoading(true);
    setPackagesError("");
    try {
      const nextPackages = [...(await listAvailableBenefitPackages(agentframeService, projectId))].sort(
        (left, right) => Number(right.IsPreset) - Number(left.IsPreset),
      );
      if (sequence !== loadSequenceRef.current) return;
      setPackages(nextPackages);
      setSelectedPackageIds(nextPackages.map((option) => option.PackageID));
    } catch (reason) {
      if (sequence !== loadSequenceRef.current) return;
      setPackagesError(reason instanceof Error ? reason.message : t("权益包加载失败，请重试"));
    } finally {
      if (sequence === loadSequenceRef.current) setPackagesLoading(false);
    }
  };

  useEffect(() => {
    loadSequenceRef.current += 1;
    setPackages([]);
    setSelectedPackageIds([]);
    setPackagesError("");
    setSubmitting(false);
    if (visible) void loadPackages();
    return () => {
      loadSequenceRef.current += 1;
    };
  }, [projectId, visible]);

  const handleRetry = () => {
    onRetry?.();
    void loadPackages();
  };

  const handleSubmit = async () => {
    if (!selectedPackageIds.length || !submissions.length) return;
    setSubmitting(true);
    try {
      const results = await batchSubmitAssetReviews(
        agentframeService,
        projectId,
        submissions.flatMap((item) =>
          selectedPackageIds.map((packageId) => ({
            packageId,
            source: item.upload ? { Upload: item.upload } : { AssetID: item.assetId },
          })),
        ),
      );
      const succeeded = results.flatMap((result) =>
        result.AssetID && result.Review ? [{ AssetID: result.AssetID, Review: result.Review }] : [],
      );
      const failedCount = results.length - succeeded.length;

      if (failedCount) {
        Message.error(
          failedCount === results.length
            ? t("送审失败，请重试")
            : t("部分送审失败（{failedCount}/{totalCount}）", {
                failedCount,
                totalCount: results.length,
              }),
        );
        if (succeeded.length) await onPartialSuccess?.(succeeded);
        return;
      }

      Message.success(t("送审提交成功"));
      await onSuccess(succeeded);
    } catch {
      Message.error(t("送审失败，请重试"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      closable={!busy}
      confirmLoading={submitting}
      maskStyle={zIndex === undefined ? undefined : { zIndex }}
      maskClosable={false}
      okButtonProps={{
        disabled: loading || packagesLoading || Boolean(loadError) || !selectedPackageIds.length || !submissions.length,
      }}
      okText={t("确定")}
      onCancel={() => {
        if (!busy) onClose();
      }}
      onOk={handleSubmit}
      className={modalSizing.compact}
      title={t("合规审核")}
      unmountOnExit
      visible={visible}
      wrapStyle={zIndex === undefined ? undefined : { zIndex }}
    >
      {loading || packagesLoading ? (
        <div className="text-center">
          <Spin />
        </div>
      ) : loadError ? (
        <div>
          <div>{t("送审信息加载失败")}</div>
          <div className="text-foreground">{loadError}</div>
          <Button onClick={handleRetry} size="small" type="text">
            {t("重新加载")}
          </Button>
        </div>
      ) : packages.length && submissions.length ? (
        <div className="flex flex-col gap-4 text-[13px] leading-5.5 text-foreground">
          <div>
            {t("将提交 {count} 个{materialName}至合规审核。", {
              count: submissions.length,
              materialName,
            })}
            <> {t("请选择一个或多个权益账号后提交审核。")}</>
          </div>
          <div className="flex flex-col gap-2 text-foreground">
            <span>{t("素材提交至：")}</span>
            <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border p-3">
              {packages.map((option) => (
                <Checkbox
                  checked={selectedPackageIds.includes(option.PackageID)}
                  key={option.PackageID}
                  onChange={(checked) =>
                    setSelectedPackageIds((current) =>
                      checked ? [...current, option.PackageID] : current.filter((id) => id !== option.PackageID),
                    )
                  }
                >
                  {option.IsPreset ? t("预置权益包") : option.Name}
                </Checkbox>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div>{packages.length ? t("暂无可送审素材") : t("暂无可用权益包")}</div>
          <div className="text-foreground">{packages.length ? t("未选择可送审素材") : t("请先配置并启用权益包")}</div>
        </div>
      )}
    </Modal>
  );
}
