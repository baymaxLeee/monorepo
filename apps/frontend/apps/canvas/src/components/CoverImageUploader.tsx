import { executeAssetUploadPlan, prepareCanvasUpload, type AssetRevisionRef } from "@repo/api";
import { Spinner, toast, Button } from "@repo/design-system";
import { randomId } from "@repo/shared";
import { ImagePlus, X } from "lucide-react";
import { type ChangeEvent, type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";

import t from "@/utils/i18n";

import styles from "./CoverImageUploader.module.less";

export function CoverImage({
  path,
  alt,
  className,
  version,
}: {
  path: string;
  alt: string;
  className?: string;
  version?: string;
}) {
  return <img alt={alt} className={className} key={version} loading="lazy" src={path} />;
}

export function CoverImageUploader({
  value,
  previewURL,
  onChange,
  onUploadingChange,
  imageAlt = t("封面"),
  removeAriaLabel = t("移除封面"),
  className,
  imageClassName,
  emptyContent,
  showReplaceAction = false,
  inputId,
  invalid,
}: {
  value?: AssetRevisionRef;
  previewURL?: string;
  onChange?: (value: AssetRevisionRef) => void;
  onUploadingChange?: (uploading: boolean) => void;
  imageAlt?: string;
  removeAriaLabel?: string;
  className?: string;
  imageClassName?: string;
  emptyContent?: ReactNode;
  showReplaceAction?: boolean;
  inputId?: string;
  invalid?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<AbortController | undefined>(undefined);
  const objectURLRef = useRef<string | undefined>(undefined);
  const uploadedRevisionRef = useRef<AssetRevisionRef | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [localPreviewURL, setLocalPreviewURL] = useState<string>();

  const clearLocalPreview = () => {
    if (objectURLRef.current) URL.revokeObjectURL(objectURLRef.current);
    objectURLRef.current = undefined;
    setLocalPreviewURL(undefined);
  };

  useEffect(() => {
    const uploaded = uploadedRevisionRef.current;
    if (value?.assetId !== uploaded?.assetId || value?.revisionId !== uploaded?.revisionId) {
      uploadedRevisionRef.current = undefined;
      clearLocalPreview();
    }
  }, [value?.assetId, value?.revisionId]);

  useEffect(
    () => () => {
      uploadRef.current?.abort();
      if (objectURLRef.current) URL.revokeObjectURL(objectURLRef.current);
    },
    [],
  );

  const selectFile = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      toast.add({
        type: "error",
        title: t("仅支持 png、jpg、jpeg 格式"),
      });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.add({
        type: "error",
        title: t("封面图片不能超过 2MB"),
      });
      return;
    }
    uploadRef.current?.abort();
    const controller = new AbortController();
    uploadRef.current = controller;
    setUploading(true);
    onUploadingChange?.(true);
    const clientRef = randomId();
    void prepareCanvasUpload({ clientRef, purpose: "cover", file })
      .then(async (plan) => {
        await executeAssetUploadPlan(plan, file, controller.signal);
        const completed = await prepareCanvasUpload({ clientRef, purpose: "cover", file });
        if (!completed.assetId || !completed.revisionId) throw new Error("completed upload is missing its revision");
        return { assetId: completed.assetId, revisionId: completed.revisionId };
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        clearLocalPreview();
        const objectURL = URL.createObjectURL(file);
        objectURLRef.current = objectURL;
        const revision = { assetId: result.assetId, revisionId: result.revisionId };
        uploadedRevisionRef.current = revision;
        setLocalPreviewURL(objectURL);
        onChange?.(revision);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          toast.add({
            type: "error",
            title: t("封面上传失败，请重新选择"),
          });
      })
      .finally(() => {
        if (uploadRef.current !== controller) return;
        uploadRef.current = undefined;
        setUploading(false);
        onUploadingChange?.(false);
      });
  };

  const select = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!uploading) selectFile(event.dataTransfer.files?.[0]);
  };

  return (
    <div
      className={`${styles.coverTrigger} ${className ?? styles.defaultUploader}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
    >
      <Button
        variant="ghost"
        className="flex h-full w-full items-center justify-center"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {localPreviewURL || previewURL ? (
          <CoverImage
            alt={imageAlt}
            className={imageClassName ?? "h-full w-full object-cover"}
            path={localPreviewURL ?? previewURL ?? ""}
          />
        ) : (
          (emptyContent ?? <ImagePlus />)
        )}
      </Button>
      <input
        ref={inputRef}
        id={inputId}
        accept="image/png,image/jpeg"
        aria-invalid={invalid}
        className="sr-only"
        onChange={select}
        type="file"
      />
      {(localPreviewURL || previewURL) && showReplaceAction ? (
        <div className={styles.replaceMask}>
          <ImagePlus className="size-10" />
        </div>
      ) : null}
      {uploading ? (
        <div className={styles.uploadingMask}>
          <Spinner aria-label={t("上传中")} />
        </div>
      ) : null}
      {(localPreviewURL || previewURL) && !uploading ? (
        <Button
          variant="ghost"
          aria-label={removeAriaLabel}
          className={styles.removeButton}
          onClick={(event) => {
            event.stopPropagation();
            const cleared = { assetId: "", revisionId: "" };
            uploadedRevisionRef.current = cleared;
            clearLocalPreview();
            onChange?.(cleared);
          }}
          type="button"
        >
          <X className={styles.removeIcon} />
        </Button>
      ) : null}
    </div>
  );
}
