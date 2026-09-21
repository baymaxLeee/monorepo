import { ImagePlus, X } from "lucide-react";
import { type ChangeEvent, type DragEvent, type ReactNode, useRef, useState } from "react";

import t from "@/utils/i18n";

import { Message, Spin } from "./ui";

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
  onChange,
  onUploadingChange,
  imageAlt = t("封面"),
  removeAriaLabel = t("移除封面"),
  className,
  imageClassName,
  emptyContent,
  showReplaceAction = false,
}: {
  value?: string;
  onChange?: (value?: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  imageAlt?: string;
  removeAriaLabel?: string;
  className?: string;
  imageClassName?: string;
  emptyContent?: ReactNode;
  showReplaceAction?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const selectFile = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      Message.error(t("仅支持 png、jpg、jpeg 格式"));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      Message.error(t("封面图片不能超过 2MB"));
      return;
    }
    setUploading(true);
    onUploadingChange?.(true);
    const reader = new FileReader();
    reader.onload = () => {
      onChange?.(typeof reader.result === "string" ? reader.result : undefined);
      setUploading(false);
      onUploadingChange?.(false);
    };
    reader.onerror = () => {
      setUploading(false);
      onUploadingChange?.(false);
      Message.error(t("封面读取失败，请重新选择"));
    };
    reader.readAsDataURL(file);
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
      <button
        className="flex h-full w-full items-center justify-center"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {value ? (
          <CoverImage alt={imageAlt} className={imageClassName ?? "h-full w-full object-cover"} path={value} />
        ) : (
          (emptyContent ?? <ImagePlus />)
        )}
      </button>
      <input ref={inputRef} accept="image/png,image/jpeg" className="sr-only" onChange={select} type="file" />
      {value && showReplaceAction ? (
        <div className={styles.replaceMask}>
          <ImagePlus className="size-10" />
        </div>
      ) : null}
      {uploading ? (
        <div className={styles.uploadingMask}>
          <Spin />
        </div>
      ) : null}
      {value && !uploading ? (
        <button
          aria-label={removeAriaLabel}
          className={styles.removeButton}
          onClick={(event) => {
            event.stopPropagation();
            onChange?.(undefined);
          }}
          type="button"
        >
          <X className={styles.removeIcon} />
        </button>
      ) : null}
    </div>
  );
}
