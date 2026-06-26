import type { FileUIPart, SourceDocumentUIPart } from "ai";
import { FileIcon, ImageIcon, XIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";
import { cn } from "shared";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { useOptionalPromptInput } from "./prompt-input";

export type AttachmentItem = (FileUIPart | SourceDocumentUIPart) & {
  id?: string;
};

export type AttachmentsProps = HTMLAttributes<HTMLDivElement> & {
  items?: AttachmentItem[];
  variant?: "inline" | "grid" | "list";
  removable?: boolean;
};

export function Attachments({
  className,
  items,
  variant = "inline",
  removable,
  ...props
}: AttachmentsProps) {
  const prompt = useOptionalPromptInput();
  const resolved = items ?? prompt?.files ?? [];
  if (!resolved.length) return null;
  return (
    <div
      className={cn(
        variant === "grid"
          ? "grid grid-cols-2 gap-2 sm:grid-cols-3"
          : variant === "list"
            ? "flex flex-col gap-2"
            : "flex flex-wrap gap-2",
        className,
      )}
      {...props}
    >
      {resolved.map((item, index) => (
        <Attachment
          key={item.id ?? `${item.type}-${index}`}
          item={item}
          onRemove={
            removable && item.id && prompt
              ? () => prompt.removeFile(item.id as string)
              : undefined
          }
        />
      ))}
    </div>
  );
}

export type AttachmentProps = ComponentProps<"div"> & {
  item: AttachmentItem;
  onRemove?: () => void;
};

export function Attachment({
  className,
  item,
  onRemove,
  ...props
}: AttachmentProps) {
  const isImage =
    item.type === "file" &&
    typeof item.mediaType === "string" &&
    item.mediaType.startsWith("image/");
  const title =
    item.type === "file"
      ? item.filename || item.mediaType || "file"
      : item.title || "source";
  return (
    <div
      className={cn(
        "group flex min-w-0 items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-xs",
        className,
      )}
      {...props}
    >
      {isImage ? (
        <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <Badge variant="outline" className="h-5 shrink-0 text-[10px]">
        {item.type}
      </Badge>
      {onRemove ? (
        <Button
          aria-label="移除附件"
          className="size-6 shrink-0 p-0 opacity-70 group-hover:opacity-100"
          size="sm"
          type="button"
          variant="ghost"
          onClick={onRemove}
        >
          <XIcon className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}
