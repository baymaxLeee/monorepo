import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@repo/design-system";
import {
  ShieldCheck as IconComplianceLine,
  Download as IconDownloadFine,
  CircleAlert as IconExclamationCircleRedFill,
  RefreshCw as IconRegenerate,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { GenerationFailureReason } from "@/components/GenerationFailureReason";
import { Button, Spin } from "@/components/ui";
import type { resource } from "@/domain";
import { resolveArtifactURL } from "@/utils/artifactURL";
import t from "@/utils/i18n";

import { ResourceTypeIcon } from "../components/ResourceTypeIcon";
import { ResourceGenerationStatus } from "../generation/ResourceGenerationStatus";

import styles from "./ResourceAssetDetailDialog.module.less";

export function ResourceAssetDetailDialog({
  asset,
  busy = false,
  children,
  generationFailure,
  generating = false,
  loading = false,
  materialName,
  resourceType,
  onClose,
  onDownload,
  onRename,
  onReplace,
  onReview,
  onSetPrimary,
  onStopGeneration,
}: {
  asset: resource.ResourceAsset;
  busy?: boolean;
  children?: React.ReactNode;
  generationFailure?: {
    code?: string;
    message?: string;
    onRetry: () => void | Promise<void>;
  };
  generating?: boolean;
  loading?: boolean;
  materialName: string;
  resourceType: resource.ResourceType;
  onClose: () => void;
  onDownload?: () => void;
  onRename?: (name: string) => Promise<boolean>;
  onReplace?: (file: File) => void | Promise<void>;
  onReview?: () => void;
  onSetPrimary?: () => unknown | Promise<unknown>;
  onStopGeneration?: () => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCancelledRef = useRef(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(asset.Name);
  const [renameSaving, setRenameSaving] = useState(false);
  const previewUrl = asset.PreviewURL ? resolveArtifactURL(asset.PreviewURL) : undefined;

  useEffect(() => {
    setRenameValue(asset.Name);
  }, [asset.Name]);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  const finishRenaming = async () => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      setRenameValue(asset.Name);
      setRenaming(false);
      return;
    }
    const nextName = renameValue.trim();
    if (!nextName || nextName === asset.Name) {
      setRenameValue(asset.Name);
      setRenaming(false);
      return;
    }
    setRenameSaving(true);
    try {
      if (await onRename?.(nextName)) {
        setRenameValue(nextName);
        setRenaming(false);
      }
    } finally {
      setRenameSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={`canvas-web-theme canvas-modal flex max-h-[90dvh] w-[520px] flex-col gap-0 p-0 sm:max-w-none ${styles.modal}`}
        style={{ maxWidth: "92vw" }}
      >
        <DialogHeader className="canvas-modal-header shrink-0 px-6 py-5">
          <DialogTitle className="canvas-modal-title">
            {renaming ? (
              <input
                aria-label={t("素材名称")}
                className="h-6 w-full min-w-0 border-0 bg-[transparent] p-0 text-[14px] font-medium leading-6 text-foreground outline-none"
                disabled={busy || renameSaving}
                maxLength={100}
                onBlur={() => void finishRenaming()}
                onChange={(event) => setRenameValue(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    renameCancelledRef.current = true;
                    event.currentTarget.blur();
                  }
                }}
                ref={renameInputRef}
                value={renameValue}
              />
            ) : onRename ? (
              <button
                aria-label={t("重命名{materialName}：{fileName}", {
                  materialName,
                  fileName: renameValue,
                })}
                className="w-full min-w-0 cursor-text truncate border-0 bg-[transparent] p-0 text-left text-[14px] font-medium leading-6 text-foreground outline-none"
                disabled={busy}
                onClick={() => {
                  renameCancelledRef.current = false;
                  setRenameValue(asset.Name);
                  setRenaming(true);
                }}
                type="button"
              >
                {renameValue}
              </button>
            ) : (
              <div className="truncate text-[14px] font-medium leading-6 text-foreground">{asset.Name}</div>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("查看和管理素材详情")}</DialogDescription>
        </DialogHeader>
        <div className="canvas-modal-content min-h-0 overflow-auto px-6 py-5">
          <section className={styles.previewCard}>
            <div
              className={`${styles.previewFrame} ${
                previewUrl && !generationFailure ? styles.previewFrameFilled : ""
              } ${generationFailure ? styles.previewFrameFailure : ""}`}
            >
              {generating ? (
                <ResourceGenerationStatus fileName={asset.Name} onStop={() => onStopGeneration?.()} variant="modal" />
              ) : generationFailure ? (
                <div
                  className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center"
                  role="alert"
                >
                  <IconExclamationCircleRedFill className="text-[40px] text-destructive" />
                  <strong className="text-[14px] font-medium leading-6 text-destructive">{t("生成失败")}</strong>
                  <GenerationFailureReason reason={generationFailure.message || t("生成失败，请重试")} />
                  <Button icon={<IconRegenerate />} onClick={() => void generationFailure.onRetry()} type="outline">
                    {t("重新生成")}
                  </Button>
                </div>
              ) : loading ? (
                <Spin tip={t("{materialName}生成中...", { materialName })} />
              ) : previewUrl ? (
                <img alt={asset.Name} className={styles.previewImage} src={previewUrl} />
              ) : (
                <ResourceTypeIcon className="text-[24px]" type={resourceType} />
              )}
              {onReplace ? (
                <>
                  <button
                    aria-label={t("替换{materialName}", { materialName })}
                    className={styles.replaceButton}
                    disabled={busy}
                    onClick={() => inputRef.current?.click()}
                    type="button"
                  />
                  <span className={styles.replaceHint}>{t("点击替换{materialName}", { materialName })}</span>
                  <input
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void onReplace(file);
                    }}
                    ref={inputRef}
                    type="file"
                  />
                </>
              ) : null}
            </div>
            <div className={styles.actions}>
              <Button
                disabled={busy || Boolean(generationFailure) || !onDownload || !previewUrl}
                icon={<IconDownloadFine aria-hidden size={16} strokeWidth={1.5} />}
                onClick={onDownload}
                type="outline"
              >
                {t("下载")}
              </Button>
              <Button
                disabled={
                  busy || Boolean(generationFailure) || !onSetPrimary || asset.IsPrimary || !asset.CurrentAssetID
                }
                icon={<ResourceTypeIcon className="text-[16px]" type={resourceType} />}
                onClick={() => void onSetPrimary?.()}
                type="outline"
              >
                {asset.IsPrimary
                  ? t("已是主{materialName}", { materialName })
                  : t("设为主{materialName}", { materialName })}
              </Button>
              <Button
                disabled={busy || Boolean(generationFailure) || !onReview || !asset.CurrentAssetID}
                icon={<IconComplianceLine aria-hidden size={16} strokeWidth={1.5} />}
                onClick={onReview}
                type="outline"
              >
                {t("提交合规审核")}
              </Button>
            </div>
          </section>
          {children ? <div className={styles.extension}>{children}</div> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
