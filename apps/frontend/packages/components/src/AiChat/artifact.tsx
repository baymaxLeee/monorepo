import type { LucideIcon } from "lucide-react";
import { XIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { cn } from "shared";
import { Button } from "../Button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../Tooltip";
import { MessageResponse } from "./message";

export type ArtifactProps = HTMLAttributes<HTMLDivElement>;

export function Artifact({ className, ...props }: ArtifactProps) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-background shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export type ArtifactHeaderProps = HTMLAttributes<HTMLDivElement>;

export function ArtifactHeader({ className, ...props }: ArtifactHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-3",
        className,
      )}
      {...props}
    />
  );
}

export type ArtifactCloseProps = ComponentProps<typeof Button>;

export function ArtifactClose({
  className,
  children,
  size = "sm",
  variant = "ghost",
  ...props
}: ArtifactCloseProps) {
  return (
    <Button
      className={cn(
        "size-8 p-0 text-muted-foreground hover:text-foreground",
        className,
      )}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children ?? <XIcon className="size-4" />}
      <span className="sr-only">Close</span>
    </Button>
  );
}

export type ArtifactTitleProps = HTMLAttributes<HTMLParagraphElement>;

export function ArtifactTitle({ className, ...props }: ArtifactTitleProps) {
  return (
    <p
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

export type ArtifactDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

export function ArtifactDescription({
  className,
  ...props
}: ArtifactDescriptionProps) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export type ArtifactActionsProps = HTMLAttributes<HTMLDivElement>;

export function ArtifactActions({ className, ...props }: ArtifactActionsProps) {
  return (
    <div className={cn("flex items-center gap-1", className)} {...props} />
  );
}

export type ArtifactActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
  icon?: LucideIcon;
};

export function ArtifactAction({
  tooltip,
  label,
  icon: Icon,
  children,
  className,
  size = "sm",
  variant = "ghost",
  ...props
}: ArtifactActionProps) {
  const button = (
    <Button
      className={cn(
        "size-8 p-0 text-muted-foreground hover:text-foreground",
        className,
      )}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {Icon ? <Icon className="size-4" /> : children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (!tooltip) return button;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export type ArtifactContentProps = HTMLAttributes<HTMLDivElement>;

export function ArtifactContent({ className, ...props }: ArtifactContentProps) {
  return (
    <div className={cn("flex-1 overflow-auto p-4", className)} {...props} />
  );
}

export type ArtifactPreviewKind = "html" | "markdown" | "text";

export type ArtifactPreviewProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  filename?: string;
  content: string;
  kind?: ArtifactPreviewKind;
  mimeType?: string;
  actions?: ReactNode;
  showHeader?: boolean;
};

function resolveArtifactPreviewKind(
  kind?: ArtifactPreviewKind,
  mimeType?: string,
  filename?: string,
): ArtifactPreviewKind {
  if (kind) return kind;
  if (mimeType?.includes("html") || filename?.endsWith(".html")) return "html";
  if (
    mimeType?.includes("markdown") ||
    filename?.endsWith(".md") ||
    filename?.endsWith(".markdown")
  ) {
    return "markdown";
  }
  return "text";
}

export function ArtifactPreview({
  className,
  title,
  filename,
  content,
  kind,
  mimeType,
  actions,
  showHeader = true,
  ...props
}: ArtifactPreviewProps) {
  const resolvedKind = resolveArtifactPreviewKind(kind, mimeType, filename);
  return (
    <Artifact className={cn("h-full min-h-0", className)} {...props}>
      {showHeader ? (
        <ArtifactHeader className="shrink-0">
          <div className="min-w-0">
            <ArtifactTitle className="truncate">{title}</ArtifactTitle>
            {filename || mimeType ? (
              <ArtifactDescription className="truncate">
                {[resolvedKind, filename, mimeType].filter(Boolean).join(" · ")}
              </ArtifactDescription>
            ) : null}
          </div>
          {actions ? <ArtifactActions>{actions}</ArtifactActions> : null}
        </ArtifactHeader>
      ) : null}
      <ArtifactContent className="min-h-0 p-0">
        {resolvedKind === "html" ? (
          <iframe
            title={title}
            sandbox="allow-scripts"
            srcDoc={content}
            className="h-full min-h-[60svh] w-full bg-white"
          />
        ) : resolvedKind === "markdown" ? (
          <div className="p-4">
            <MessageResponse>{content}</MessageResponse>
          </div>
        ) : (
          <pre className="h-full min-h-[60svh] overflow-auto whitespace-pre-wrap p-4 text-sm">
            {content}
          </pre>
        )}
      </ArtifactContent>
    </Artifact>
  );
}
