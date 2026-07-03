import type { LucideIcon } from "lucide-react";
import { cn } from "shared";

// A lightweight transcript card for a media product (generated image group /
// video). It renders ZERO media bytes at mount — just an icon + label the user
// clicks to open the real preview surface (image lightbox / side panel), which
// fetches the bytes on demand. This keeps the chat transcript cheap to render
// and re-render on conversation switch; see ADR-0021. The whole card is one
// button (no nested interactive element) so the entire surface is the target.
export function ChatMediaCard({
  icon: Icon,
  title,
  description,
  note,
  actionLabel = "预览",
  onOpen,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  note?: string;
  actionLabel?: string;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex w-full items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3 text-left shadow-sm transition-colors hover:border-primary/60 hover:bg-muted/40",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">
            {title}
          </span>
          {description || note ? (
            <span className="block truncate text-sm text-muted-foreground">
              {description}
              {note ? (
                <span className="ml-1 text-destructive">· {note}</span>
              ) : null}
            </span>
          ) : null}
        </span>
      </span>
      <span className="shrink-0 rounded-md border px-2.5 py-1 text-xs text-muted-foreground group-hover:text-foreground">
        {actionLabel}
      </span>
    </button>
  );
}
