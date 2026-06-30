import type { FileUIPart, SourceDocumentUIPart } from "ai";
import {
  FileIcon,
  ImageIcon,
  MusicIcon,
  PlaySquareIcon,
  XIcon,
} from "lucide-react";
import { Slot } from "radix-ui";
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useContext,
} from "react";
import { cn } from "shared";
import { Button } from "../Button";

export type AttachmentItem = (FileUIPart | SourceDocumentUIPart) & {
  id?: string;
};

export type AttachmentCategory =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "source";

export function getMediaCategory(item: AttachmentItem): AttachmentCategory {
  if (item.type === "source-document") return "source";
  if (item.mediaType.startsWith("image/")) return "image";
  if (item.mediaType.startsWith("video/")) return "video";
  if (item.mediaType.startsWith("audio/")) return "audio";
  return "document";
}

export function getAttachmentLabel(item: AttachmentItem): string {
  return item.type === "file"
    ? item.filename || item.mediaType || "附件"
    : item.title || item.filename || "来源文档";
}

export type AttachmentsProps = HTMLAttributes<HTMLDivElement> & {
  variant?: "inline" | "grid" | "list";
};

export function Attachments({
  className,
  variant = "inline",
  ...props
}: AttachmentsProps) {
  return (
    <div
      data-variant={variant}
      className={cn(
        variant === "grid"
          ? "grid grid-cols-2 gap-2 sm:grid-cols-3"
          : variant === "list"
            ? "flex flex-col gap-2"
            : "flex flex-wrap gap-2",
        className,
      )}
      {...props}
    />
  );
}

type AttachmentContextValue = {
  item: AttachmentItem;
  onRemove?: () => void;
};

const AttachmentContext = createContext<AttachmentContextValue | null>(null);

function useAttachment() {
  const context = useContext(AttachmentContext);
  if (!context)
    throw new Error("Attachment parts must be rendered inside Attachment");
  return context;
}

export type AttachmentProps = ComponentProps<"div"> & {
  data: AttachmentItem;
  onRemove?: () => void;
  asChild?: boolean;
};

export function Attachment({
  className,
  data,
  onRemove,
  asChild,
  children,
  ...props
}: AttachmentProps) {
  const Comp = asChild ? Slot.Root : "div";
  return (
    <AttachmentContext.Provider value={{ item: data, onRemove }}>
      <Comp
        className={cn(
          "group flex min-w-0 items-center gap-2 rounded-lg border bg-background px-2 py-1.5 text-left text-xs",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <AttachmentPreview />
            <AttachmentInfo />
            {onRemove ? <AttachmentRemove /> : null}
          </>
        )}
      </Comp>
    </AttachmentContext.Provider>
  );
}

export type AttachmentPreviewProps = HTMLAttributes<HTMLDivElement> & {
  fallbackIcon?: ReactNode;
};

export function AttachmentPreview({
  className,
  fallbackIcon,
  ...props
}: AttachmentPreviewProps) {
  const { item } = useAttachment();
  const category = getMediaCategory(item);
  const label = getAttachmentLabel(item);
  const icon =
    fallbackIcon ??
    (category === "image" ? (
      <ImageIcon className="size-4" />
    ) : category === "video" ? (
      <PlaySquareIcon className="size-4" />
    ) : category === "audio" ? (
      <MusicIcon className="size-4" />
    ) : (
      <FileIcon className="size-4" />
    ));

  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground",
        category === "image" && item.type === "file" && "size-12",
        className,
      )}
      {...props}
    >
      {category === "image" && item.type === "file" ? (
        <img
          src={item.url}
          alt={label}
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        icon
      )}
    </div>
  );
}

export type AttachmentInfoProps = HTMLAttributes<HTMLDivElement> & {
  showMediaType?: boolean;
};

export function AttachmentInfo({
  className,
  showMediaType,
  ...props
}: AttachmentInfoProps) {
  const { item } = useAttachment();
  return (
    <div className={cn("min-w-0 flex-1", className)} {...props}>
      <p className="truncate font-medium">{getAttachmentLabel(item)}</p>
      {showMediaType ? (
        <p className="truncate text-[10px] text-muted-foreground">
          {item.mediaType}
        </p>
      ) : null}
    </div>
  );
}

export type AttachmentRemoveProps = ComponentProps<typeof Button> & {
  label?: string;
};

export function AttachmentRemove({
  className,
  label = "移除附件",
  onClick,
  ...props
}: AttachmentRemoveProps) {
  const { onRemove } = useAttachment();
  if (!onRemove) return null;
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={label}
      className={cn(
        "size-6 shrink-0 opacity-70 group-hover:opacity-100",
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
        if (!event.defaultPrevented) onRemove();
      }}
      {...props}
    >
      <XIcon className="size-3" />
    </Button>
  );
}
