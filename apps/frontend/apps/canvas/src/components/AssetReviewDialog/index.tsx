import {
  Button as DialogButton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system";
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { batchSubmitAssetReviews, listAvailableBenefitPackages } from "@/api/assetReviews";
import { Button, Checkbox, Message, Spin } from "@/components/ui";
import type { asset, benefit_package } from "@/domain";
import t from "@/utils/i18n";

import dialogSizing from "@/components/DialogSizing.module.less";

export interface AssetReviewItem {
  assetId?: string;
  review?: asset.AssetReview;
  upload?: asset.AssetReviewUpload;
}

export interface AssetReviewDialogProps {
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
}

export function AssetReviewDialog({
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
}: AssetReviewDialogProps) {
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
      const nextPackages = [...(await listAvailableBenefitPackages())].sort(
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
    <Dialog open={visible} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className={`canvas-web-theme canvas-modal flex max-h-[90dvh] w-[520px] flex-col gap-0 p-0 sm:max-w-none ${dialogSizing.compact}`}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        showCloseButton={!busy}
        style={{ maxWidth: "92vw" }}
      >
        <DialogHeader className="canvas-modal-header shrink-0 px-6 py-5">
          <DialogTitle className="canvas-modal-title">{t("合规审核")}</DialogTitle>
          <DialogDescription className="sr-only">{t("选择权益包并提交素材审核")}</DialogDescription>
        </DialogHeader>
        <div className="canvas-modal-content min-h-0 overflow-auto px-6 py-5">
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
              <div className="text-foreground">
                {packages.length ? t("未选择可送审素材") : t("请先配置并启用权益包")}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="canvas-modal-footer shrink-0 px-6 py-4">
          <DialogButton disabled={busy} onClick={onClose} type="button" variant="outline">
            {t("取消")}
          </DialogButton>
          <DialogButton
            disabled={
              busy ||
              loading ||
              packagesLoading ||
              Boolean(loadError) ||
              !selectedPackageIds.length ||
              !submissions.length
            }
            onClick={() => void handleSubmit()}
            type="button"
          >
            {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {t("确定")}
          </DialogButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
