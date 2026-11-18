import { cn } from "@repo/shared";
import { FileIcon } from "lucide-react";

export function ChatFileTag({ filename, title, onOpen }: { filename: string; title: string; onOpen?: () => void }) {
  const label = title || filename;
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <button
        type="button"
        className={cn(
          "inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-primary",
          onOpen ? "cursor-pointer hover:bg-accent hover:underline" : "cursor-default",
        )}
        title={filename}
        aria-label={onOpen ? `打开文件 ${label}` : undefined}
        disabled={!onOpen}
        onClick={onOpen}
      >
        <FileIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </button>
    </span>
  );
}
