import { cn } from "@repo/shared";
import { FileIcon, PlayIcon } from "lucide-react";

export function ChatFileTag({
  filename,
  title,
  onOpen,
  onExecute,
  executed,
  busy,
}: {
  filename: string;
  title: string;
  onOpen?: () => void;
  onExecute?: () => void;
  executed?: boolean;
  busy?: boolean;
}) {
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
      {onExecute ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={executed ? `再次执行 ${label}` : `执行 ${label}`}
          disabled={busy}
          onClick={onExecute}
        >
          <PlayIcon className="size-3" aria-hidden="true" />
          {executed ? "再次执行" : "执行"}
        </button>
      ) : null}
    </span>
  );
}
