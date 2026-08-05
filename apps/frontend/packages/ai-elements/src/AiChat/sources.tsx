import { Badge } from "@repo/design-system/shadcn/badge";
import { cn, isPublicHttpUrl } from "@repo/shared";
import type { SourceUrlUIPart } from "ai";
import { ExternalLinkIcon, LinkIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

export type SourceItem =
  | SourceUrlUIPart
  | {
      type?: "source-url" | "source-document";
      id?: string;
      title?: string;
      url?: string;
      sourceId?: string;
      mediaType?: string;
      filename?: string;
    };

export type SourcesProps = HTMLAttributes<HTMLDivElement> & {
  sources: SourceItem[];
};

export function Sources({ className, sources, ...props }: SourcesProps) {
  if (!sources.length) {
    return null;
  }
  return (
    <div className={cn("flex flex-col gap-2", className)} {...props}>
      {sources.map((source, index) => (
        <Source key={sourceKey(source, index)} source={source} />
      ))}
    </div>
  );
}

function sourceKey(source: SourceItem, index: number) {
  const value = source as Record<string, unknown>;
  return String(value.id ?? value.sourceId ?? value.url ?? index);
}

export type SourceProps = ComponentProps<"a"> & {
  source: SourceItem;
};

export function Source({ className, source, ...props }: SourceProps) {
  const value = source as Record<string, unknown>;
  const title = String(value.title ?? value.filename ?? value.url ?? "Source");
  const rawHref = typeof value.url === "string" ? value.url : undefined;
  const href = rawHref && isPublicHttpUrl(rawHref) ? rawHref : undefined;
  const content = (
    <>
      <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {source.type ? (
        <Badge variant="outline" className="h-5 shrink-0 text-[10px]">
          {source.type.replace("source-", "")}
        </Badge>
      ) : null}
      {href ? <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" /> : null}
    </>
  );
  if (!href) {
    return (
      <div
        className={cn("flex min-w-0 items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs", className)}
      >
        {content}
      </div>
    );
  }
  return (
    <a
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs text-foreground hover:bg-accent",
        className,
      )}
      href={href}
      rel="noreferrer"
      target="_blank"
      {...props}
    >
      {content}
    </a>
  );
}

export type InlineCitationProps = ComponentProps<"a"> & {
  index?: number;
  source?: SourceItem;
  children?: ReactNode;
};

export function InlineCitation({ className, index, source, children, href: propsHref, ...props }: InlineCitationProps) {
  const rawHref = propsHref ?? source?.url;
  const href = typeof rawHref === "string" && isPublicHttpUrl(rawHref) ? rawHref : undefined;
  const classNameMerged = cn(
    "inline-flex h-5 min-w-5 items-center justify-center rounded-full border bg-muted px-1.5 align-baseline text-[10px] font-medium text-muted-foreground hover:text-foreground",
    className,
  );
  if (!href) {
    return (
      <span className={classNameMerged} {...props}>
        {children ?? index ?? "src"}
      </span>
    );
  }
  return (
    <a className={classNameMerged} href={href} rel="noreferrer" target="_blank" {...props}>
      {children ?? index ?? "src"}
    </a>
  );
}
