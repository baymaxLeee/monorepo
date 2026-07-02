import type { LucideIcon } from "lucide-react";
import { XIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { cn } from "shared";
import { Button } from "../shadcn/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shadcn/tooltip";
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

export type ArtifactPreviewKind =
  | "html"
  | "markdown"
  | "text"
  | "image"
  | "video"
  | "audio"
  | "pdf";

// Compiler-trusted artifacts (write_file/edit_file output) embed their own
// runtime head — CSP that allows the pinned ECharts CDN plus the compiler's
// trusted inline hydration/nav/error-boundary scripts — marked with this
// attribute (see chat's buildArtifactRuntimeHead). Only fall back to a
// script-blocking CSP for content that lacks that marker, e.g. arbitrary
// uploaded HTML documents that never passed through the artifact compiler.
const TRUSTED_ARTIFACT_RUNTIME_MARKER = 'data-chat-artifact-runtime="true"';

const UNTRUSTED_HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "script-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data: blob:",
  "style-src 'unsafe-inline'",
].join("; ");

function sandboxedHtml(content: string) {
  if (content.includes(TRUSTED_ARTIFACT_RUNTIME_MARKER)) return content;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${UNTRUSTED_HTML_PREVIEW_CSP}">`;
  const headOpen = content.match(/<head\b[^>]*>/i);
  if (headOpen?.index !== undefined) {
    const insertAt = headOpen.index + headOpen[0].length;
    return `${content.slice(0, insertAt)}${meta}${content.slice(insertAt)}`;
  }
  return `${meta}${content}`;
}

export type ArtifactPreviewProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  filename?: string;
  content: string;
  src?: string;
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
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("audio/")) return "audio";
  if (mimeType?.includes("pdf") || filename?.endsWith(".pdf")) return "pdf";
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
  src,
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
        {resolvedKind === "image" && src ? (
          <div className="flex h-full min-h-[40svh] items-center justify-center bg-muted/20 p-4">
            <img
              src={src}
              alt={title}
              className="max-h-[70svh] max-w-full object-contain"
            />
          </div>
        ) : resolvedKind === "video" && src ? (
          // biome-ignore lint/a11y/useMediaCaption: uploaded media has no separate caption track
          <video
            src={src}
            controls
            className="h-full min-h-[40svh] w-full bg-black"
          />
        ) : resolvedKind === "audio" && src ? (
          <div className="flex min-h-[20svh] items-center justify-center p-6">
            {/* biome-ignore lint/a11y/useMediaCaption: uploaded media has no separate caption track */}
            <audio src={src} controls className="w-full max-w-xl" />
          </div>
        ) : resolvedKind === "pdf" && src ? (
          <iframe
            title={title}
            src={src}
            className="h-full min-h-[60svh] w-full bg-white"
          />
        ) : resolvedKind === "html" ? (
          <iframe
            title={title}
            // Opaque origin (no allow-same-origin): scripts can run — required
            // for the compiler's trusted chart-hydration/nav/error-boundary
            // scripts (see ADR-0012) — but the frame can never read parent
            // cookies/localStorage, navigate the top window, or open popups.
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            src={src}
            srcDoc={src ? undefined : sandboxedHtml(content)}
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
