import { Badge } from "@repo/design-system/shadcn/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@repo/design-system/shadcn/collapsible";
import { cn, isPublicHttpUrl } from "@repo/shared";
import type { SourceUrlUIPart } from "ai";
import { ChevronDownIcon, ExternalLinkIcon, LinkIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

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

export type SourcesProps = ComponentProps<typeof Collapsible> & {
  sources?: SourceItem[];
};

export function Sources({ className, sources, children, ...props }: SourcesProps) {
  if (sources && !sources.length) {
    return null;
  }
  return (
    <Collapsible className={cn("not-prose mb-4 text-xs text-primary", className)} {...props}>
      {children ?? (
        <>
          <SourcesTrigger count={sources?.length ?? 0} />
          <SourcesContent>
            {sources?.map((source, index) => (
              <Source key={sourceKey(source, index)} source={source} />
            ))}
          </SourcesContent>
        </>
      )}
    </Collapsible>
  );
}

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & { count: number };

export function SourcesTrigger({ className, count, children, ...props }: SourcesTriggerProps) {
  return (
    <CollapsibleTrigger className={cn("flex items-center gap-2", className)} {...props}>
      {children ?? (
        <>
          <span className="font-medium">Used {count} sources</span>
          <ChevronDownIcon className="size-4" />
        </>
      )}
    </CollapsibleTrigger>
  );
}

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export function SourcesContent({ className, ...props }: SourcesContentProps) {
  return <CollapsibleContent className={cn("mt-3 flex w-fit flex-col gap-2 outline-none", className)} {...props} />;
}

function sourceKey(source: SourceItem, index: number) {
  const value = source as Record<string, unknown>;
  return String(value.id ?? value.sourceId ?? value.url ?? index);
}

export type SourceProps = ComponentProps<"a"> & {
  source?: SourceItem;
};

export function Source({ className, source, href: propsHref, title: propsTitle, children, ...props }: SourceProps) {
  const value = (source ?? {}) as Record<string, unknown>;
  const title = String(propsTitle ?? value.title ?? value.filename ?? value.url ?? propsHref ?? "Source");
  const rawHref = propsHref ?? (typeof value.url === "string" ? value.url : undefined);
  const href = rawHref && isPublicHttpUrl(rawHref) ? rawHref : undefined;
  const content = children ?? (
    <>
      <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {source?.type ? (
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
      title={propsTitle}
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
