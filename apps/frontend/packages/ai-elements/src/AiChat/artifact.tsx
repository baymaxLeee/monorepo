import { Button } from "@repo/design-system/shadcn/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@repo/design-system/shadcn/tooltip";
import { cn, isPublicHttpUrl } from "@repo/shared";
import type { LucideIcon } from "lucide-react";
import { XIcon } from "lucide-react";
import { type ComponentProps, type HTMLAttributes, type ReactNode, useLayoutEffect, useRef } from "react";

import { MessageResponse } from "./message";

export type ArtifactProps = HTMLAttributes<HTMLDivElement>;

export function Artifact({ className, ...props }: ArtifactProps) {
  return (
    <div
      className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-sm", className)}
      {...props}
    />
  );
}

export type ArtifactHeaderProps = HTMLAttributes<HTMLDivElement>;

export function ArtifactHeader({ className, ...props }: ArtifactHeaderProps) {
  return (
    <div
      className={cn("flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-3", className)}
      {...props}
    />
  );
}

export type ArtifactCloseProps = ComponentProps<typeof Button>;

export function ArtifactClose({ className, children, size = "sm", variant = "ghost", ...props }: ArtifactCloseProps) {
  return (
    <Button
      className={cn("size-8 p-0 text-muted-foreground hover:text-foreground", className)}
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
  return <p className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

export type ArtifactDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

export function ArtifactDescription({ className, ...props }: ArtifactDescriptionProps) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export type ArtifactActionsProps = HTMLAttributes<HTMLDivElement>;

export function ArtifactActions({ className, ...props }: ArtifactActionsProps) {
  return <div className={cn("flex items-center gap-1", className)} {...props} />;
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
      className={cn("size-8 p-0 text-muted-foreground hover:text-foreground", className)}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {Icon ? <Icon className="size-4" /> : children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (!tooltip) {
    return button;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export type ArtifactContentProps = HTMLAttributes<HTMLDivElement>;

export function ArtifactContent({ className, ...props }: ArtifactContentProps) {
  return <div className={cn("min-w-0 flex-1 overflow-auto p-4", className)} {...props} />;
}

export type ArtifactPreviewKind = "html" | "markdown" | "text" | "image" | "video" | "audio" | "pdf";

function isAllowedArtifactSrc(src: string): boolean {
  // Asset mints signed, same-origin resource paths. Reject network-path
  // references and URL-normalization escapes instead of discarding relative URLs.
  if (src.startsWith("/")) {
    return !src.startsWith("//") && !/[\\\u0000-\u0020\u007f]/.test(src);
  }
  if (src.startsWith("blob:")) {
    return true;
  }
  return isPublicHttpUrl(src);
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
  renderText?: (content: string) => ReactNode;
  onResourceError?: () => void;
};

export function resolveArtifactPreviewKind(
  kind?: ArtifactPreviewKind,
  mimeType?: string,
  filename?: string,
): ArtifactPreviewKind {
  if (kind) {
    return kind;
  }
  mimeType = mimeType?.split(";")[0].trim().toLowerCase();
  filename = filename?.toLowerCase();
  if (mimeType?.startsWith("image/")) {
    return "image";
  }
  if (mimeType?.startsWith("video/")) {
    return "video";
  }
  if (mimeType?.startsWith("audio/")) {
    return "audio";
  }
  if (mimeType?.includes("pdf") || filename?.endsWith(".pdf")) {
    return "pdf";
  }
  if (mimeType?.includes("html") || filename?.endsWith(".html") || filename?.endsWith(".htm")) {
    return "html";
  }
  if (mimeType?.includes("markdown") || filename?.endsWith(".md") || filename?.endsWith(".markdown")) {
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
  renderText,
  onResourceError,
  ...props
}: ArtifactPreviewProps) {
  const resolvedKind = resolveArtifactPreviewKind(kind, mimeType, filename);
  const safeSrc = src && isAllowedArtifactSrc(src) ? src : undefined;
  return (
    <Artifact className={cn("h-full min-h-0 min-w-0", className)} {...props}>
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
        {resolvedKind === "image" && safeSrc ? (
          <div className="flex h-full min-h-[40svh] items-center justify-center bg-muted/20 p-4">
            <img
              src={safeSrc}
              onError={onResourceError}
              referrerPolicy="no-referrer"
              alt={title}
              className="max-h-[70svh] max-w-full object-contain"
            />
          </div>
        ) : resolvedKind === "video" && safeSrc ? (
          // biome-ignore lint/a11y/useMediaCaption: uploaded media has no separate caption track
          <ArtifactMedia kind="video" src={safeSrc} onError={onResourceError} />
        ) : resolvedKind === "audio" && safeSrc ? (
          <div className="flex min-h-[20svh] items-center justify-center p-6">
            {/* biome-ignore lint/a11y/useMediaCaption: uploaded media has no separate caption track */}
            <ArtifactMedia kind="audio" src={safeSrc} onError={onResourceError} />
          </div>
        ) : resolvedKind === "pdf" && safeSrc ? (
          <iframe
            title={title}
            src={safeSrc}
            onError={onResourceError}
            referrerPolicy="no-referrer"
            className="h-full min-h-[60svh] min-w-0 w-full bg-white"
          />
        ) : resolvedKind === "html" ? (
          <iframe
            title={title}
            allowFullScreen
            onError={onResourceError}
            src={safeSrc ?? undefined}
            srcDoc={safeSrc ? undefined : content}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
            className="h-full min-h-[60svh] min-w-0 w-full bg-white"
          />
        ) : resolvedKind === "markdown" ? (
          <div className="p-4">
            <MessageResponse>{content}</MessageResponse>
          </div>
        ) : renderText ? (
          renderText(content)
        ) : (
          <pre className="h-full min-h-[60svh] overflow-auto whitespace-pre-wrap p-4 text-sm">{content}</pre>
        )}
      </ArtifactContent>
    </Artifact>
  );
}

function ArtifactMedia({ kind, src, onError }: { kind: "video" | "audio"; src: string; onError?: () => void }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useLayoutEffect(() => {
    const media = ref.current;
    if (!media) return;
    const position = media.currentTime;
    const playing = !media.paused;
    const restore = () => {
      if (position > 0) media.currentTime = position;
      if (playing) void media.play().catch(() => {});
    };
    media.addEventListener("loadedmetadata", restore, { once: true });
    media.src = src;
    media.load();
    return () => media.removeEventListener("loadedmetadata", restore);
  }, [src]);
  return kind === "video" ? (
    <video ref={ref} controls preload="metadata" onError={onError} className="h-full min-h-[40svh] w-full bg-black" />
  ) : (
    <audio ref={ref} controls preload="metadata" onError={onError} className="w-full max-w-xl" />
  );
}
