import { useRender } from "@base-ui/react/use-render";
import { Button } from "@repo/design-system/shadcn/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@repo/design-system/shadcn/hover-card";
import { cn } from "@repo/shared";
import type { FileUIPart, SourceDocumentUIPart } from "ai";
import { FileIcon, ImageIcon, MusicIcon, PlaySquareIcon, XIcon } from "lucide-react";
import { type ComponentProps, createContext, type HTMLAttributes, type ReactNode, useContext } from "react";

export type AttachmentItem = (FileUIPart | SourceDocumentUIPart) & {
  id?: string;
};

export type AttachmentCategory = "image" | "video" | "audio" | "document" | "source";
export type AttachmentData = AttachmentItem;
export type AttachmentMediaCategory = AttachmentCategory;
export type AttachmentVariant = "grid" | "inline" | "list";

export function getMediaCategory(item: AttachmentItem): AttachmentCategory {
  if (item.type === "source-document") {
    return "source";
  }
  if (item.mediaType.startsWith("image/")) {
    return "image";
  }
  if (item.mediaType.startsWith("video/")) {
    return "video";
  }
  if (item.mediaType.startsWith("audio/")) {
    return "audio";
  }
  return "document";
}

export function getAttachmentLabel(item: AttachmentItem): string {
  return item.type === "file" ? item.filename || item.mediaType || "附件" : item.title || item.filename || "来源文档";
}

export type AttachmentsProps = HTMLAttributes<HTMLDivElement> & {
  variant?: AttachmentVariant;
};

const AttachmentsContext = createContext<{ variant: AttachmentVariant }>({ variant: "inline" });

export function Attachments({ className, variant = "grid", ...props }: AttachmentsProps) {
  return (
    <AttachmentsContext.Provider value={{ variant }}>
      <div
        data-variant={variant}
        className={cn(
          "flex items-start",
          variant === "list" ? "flex-col gap-2" : "flex-wrap gap-2",
          variant === "grid" && "ml-auto w-fit",
          className,
        )}
        {...props}
      />
    </AttachmentsContext.Provider>
  );
}

type AttachmentContextValue = {
  item: AttachmentItem;
  onRemove?: () => void;
  variant: AttachmentVariant;
};

const AttachmentContext = createContext<AttachmentContextValue | null>(null);

export function useAttachmentContext() {
  const context = useContext(AttachmentContext);
  if (!context) {
    throw new Error("Attachment parts must be rendered inside Attachment");
  }
  return context;
}

export function useAttachmentsContext() {
  return useContext(AttachmentsContext);
}

export type AttachmentProps = ComponentProps<"div"> & {
  data: AttachmentItem;
  onRemove?: () => void;
  render?: React.ReactElement;
};

export function Attachment({ className, data, onRemove, render, children, ...props }: AttachmentProps) {
  const { variant } = useAttachmentsContext();
  const element = useRender({
    defaultTagName: "div",
    render,
    props: {
      className: cn(
        "group relative min-w-0 rounded-lg border bg-background text-left text-xs",
        variant === "grid" && "size-24 overflow-hidden",
        variant === "inline" && "flex h-8 max-w-full items-center gap-1.5 px-1.5",
        variant === "list" && "flex w-full items-center gap-3 p-3",
        className,
      ),
      children: children ?? (
        <>
          <AttachmentPreview />
          <AttachmentInfo />
          {onRemove ? <AttachmentRemove /> : null}
        </>
      ),
      ...props,
    },
  });
  return <AttachmentContext.Provider value={{ item: data, onRemove, variant }}>{element}</AttachmentContext.Provider>;
}

export type AttachmentPreviewProps = HTMLAttributes<HTMLDivElement> & {
  fallbackIcon?: ReactNode;
};

export function AttachmentPreview({ className, fallbackIcon, ...props }: AttachmentPreviewProps) {
  const { item, variant } = useAttachmentContext();
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
        "flex shrink-0 items-center justify-center overflow-hidden bg-muted text-muted-foreground",
        variant === "grid" && "size-full",
        variant === "inline" && "size-5 rounded",
        variant === "list" && "size-12 rounded",
        className,
      )}
      {...props}
    >
      {category === "image" && item.type === "file" ? (
        <img src={item.url} alt={label} loading="lazy" className="size-full object-cover" />
      ) : (
        icon
      )}
    </div>
  );
}

export type AttachmentInfoProps = HTMLAttributes<HTMLDivElement> & {
  showMediaType?: boolean;
};

export function AttachmentInfo({ className, showMediaType, ...props }: AttachmentInfoProps) {
  const { item, variant } = useAttachmentContext();
  if (variant === "grid") {
    return null;
  }
  return (
    <div className={cn("min-w-0 flex-1", className)} {...props}>
      <p className="truncate font-medium">{getAttachmentLabel(item)}</p>
      {showMediaType ? <p className="truncate text-[10px] text-muted-foreground">{item.mediaType}</p> : null}
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
  children,
  ...props
}: AttachmentRemoveProps) {
  const { onRemove, variant } = useAttachmentContext();
  if (!onRemove) {
    return null;
  }
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={label}
      className={cn(
        variant === "grid" &&
          "absolute top-2 right-2 size-6 rounded-full bg-background/80 opacity-0 backdrop-blur-sm group-hover:opacity-100",
        variant === "inline" && "size-5 shrink-0 opacity-0 group-hover:opacity-100",
        variant === "list" && "size-8 shrink-0",
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
        if (!event.defaultPrevented) {
          onRemove();
        }
      }}
      {...props}
    >
      {children ?? <XIcon className="size-3" />}
    </Button>
  );
}

export type AttachmentHoverCardProps = ComponentProps<typeof HoverCard>;

export function AttachmentHoverCard(props: AttachmentHoverCardProps) {
  return <HoverCard {...props} />;
}

export type AttachmentHoverCardTriggerProps = ComponentProps<typeof HoverCardTrigger>;

export function AttachmentHoverCardTrigger(props: AttachmentHoverCardTriggerProps) {
  return <HoverCardTrigger {...props} />;
}

export type AttachmentHoverCardContentProps = ComponentProps<typeof HoverCardContent>;

export function AttachmentHoverCardContent({ className, align = "start", ...props }: AttachmentHoverCardContentProps) {
  return <HoverCardContent align={align} className={cn("w-auto p-2", className)} {...props} />;
}

export type AttachmentEmptyProps = HTMLAttributes<HTMLDivElement>;

export function AttachmentEmpty({ className, children, ...props }: AttachmentEmptyProps) {
  return (
    <div className={cn("flex items-center justify-center p-4 text-sm text-muted-foreground", className)} {...props}>
      {children ?? "No attachments"}
    </div>
  );
}
