import {
  ChevronLeft,
  ChevronRight,
  Download,
  type LucideIcon,
  Maximize,
  Menu,
  Minimize,
  Minus,
  Plus,
  RotateCw,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { cn } from "shared";
import { Button } from "../../Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../DropdownMenu";
import { Input } from "../../Input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../Tooltip";
import type { PdfSidebarType, PdfToolbarConfig } from "../interface";

export const DEFAULT_TOOLBAR_CONFIG: Required<PdfToolbarConfig> = {
  pageNav: true,
  zoom: true,
  rotate: true,
  download: true,
  fullscreen: true,
  outline: true,
  thumbnail: true,
};

type SidebarMenuKey = "none" | "outline" | "thumbnail";

const SIDEBAR_PRESETS: Array<{ key: SidebarMenuKey; label: string }> = [
  { key: "none", label: "无" },
  { key: "outline", label: "大纲" },
  { key: "thumbnail", label: "缩略图" },
];

export const FIT_PRESETS: Array<{
  key: "page-width" | "page-height" | "page-fit";
  label: string;
}> = [
  { key: "page-width", label: "适配宽度" },
  { key: "page-height", label: "适配高度" },
  { key: "page-fit", label: "整页适配" },
];

export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.5, 2, 3] as const;

export interface PdfToolbarProps {
  enabled: Required<PdfToolbarConfig>;
  numPages: number;
  currentPage: number;
  scale: number;
  minScale: number;
  maxScale: number;
  fullscreen: boolean;
  canOperate: boolean;
  downloadDisabled: boolean;
  sidebarType: PdfSidebarType;
  /** 用作 Tooltip / DropdownMenu 的 portal 容器（fullscreen 下需要挂到 root 内部） */
  popupContainer?: HTMLElement | null;
  onPrevPage: () => void;
  onNextPage: () => void;
  onGoToPage: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetScale: (scale: number) => void;
  onFit: (key: "page-width" | "page-height" | "page-fit") => void;
  onRotate: () => void;
  onDownload: () => void;
  onToggleFullscreen: () => void;
  onSetSidebar: (type: PdfSidebarType) => void;
  extra?: ReactNode;
}

const PdfToolbar = ({
  enabled,
  numPages,
  currentPage,
  scale,
  minScale,
  maxScale,
  fullscreen,
  canOperate,
  downloadDisabled,
  sidebarType,
  popupContainer,
  onPrevPage,
  onNextPage,
  onGoToPage,
  onZoomIn,
  onZoomOut,
  onSetScale,
  onFit,
  onRotate,
  onDownload,
  onToggleFullscreen,
  onSetSidebar,
  extra,
}: PdfToolbarProps) => {
  const sidebarPresets = useMemo(
    () =>
      SIDEBAR_PRESETS.filter((preset) => {
        if (preset.key === "outline") return enabled.outline;
        if (preset.key === "thumbnail") return enabled.thumbnail;
        return true;
      }),
    [enabled.outline, enabled.thumbnail],
  );

  const atFirstPage = currentPage <= 1;
  const atLastPage = numPages > 0 ? currentPage >= numPages : true;
  const atMinScale = scale <= minScale + 1e-4;
  const atMaxScale = scale >= maxScale - 1e-4;

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-3 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-md border bg-background/90 px-2 py-1 shadow-lg backdrop-blur-md"
      data-testid="pdf-toolbar"
      role="toolbar"
    >
      {enabled.outline || enabled.thumbnail ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canOperate}
                  aria-label="toggle-sidebar"
                  className="size-7 p-0"
                >
                  <Menu className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent container={popupContainer}>侧边栏</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="start"
            container={popupContainer}
            className="min-w-28"
          >
            {sidebarPresets.map((preset) => {
              const active = (sidebarType ?? "none") === preset.key;
              return (
                <DropdownMenuItem
                  key={preset.key}
                  data-active={active || undefined}
                  className={cn(
                    active && "bg-accent text-accent-foreground",
                    "justify-between",
                  )}
                  onSelect={() => {
                    onSetSidebar(preset.key === "none" ? null : preset.key);
                  }}
                >
                  {preset.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {enabled.pageNav ? (
        <ToolbarGroup>
          <ToolbarIconButton
            icon={ChevronLeft}
            label="上一页"
            disabled={!canOperate || atFirstPage}
            popupContainer={popupContainer}
            onClick={onPrevPage}
            ariaLabel="prev-page"
          />
          <PageInput
            value={currentPage}
            numPages={numPages}
            disabled={!canOperate}
            onCommit={onGoToPage}
          />
          <ToolbarIconButton
            icon={ChevronRight}
            label="下一页"
            disabled={!canOperate || atLastPage}
            popupContainer={popupContainer}
            onClick={onNextPage}
            ariaLabel="next-page"
          />
        </ToolbarGroup>
      ) : null}

      {enabled.zoom ? (
        <ToolbarGroup>
          <ToolbarIconButton
            icon={Minus}
            label="缩小"
            disabled={!canOperate || atMinScale}
            popupContainer={popupContainer}
            onClick={onZoomOut}
            ariaLabel="zoom-out"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!canOperate}
                className="h-7 min-w-14 rounded-none px-2 font-mono text-xs"
              >
                {Math.round(scale * 100)}%
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="center"
              container={popupContainer}
              className="min-w-32"
            >
              {FIT_PRESETS.map((preset) => (
                <DropdownMenuItem
                  key={preset.key}
                  onSelect={() => onFit(preset.key)}
                >
                  {preset.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              {ZOOM_PRESETS.map((value) => (
                <DropdownMenuItem
                  key={String(value)}
                  className="justify-end font-mono"
                  onSelect={() => onSetScale(value)}
                >
                  {Math.round(value * 100)}%
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolbarIconButton
            icon={Plus}
            label="放大"
            disabled={!canOperate || atMaxScale}
            popupContainer={popupContainer}
            onClick={onZoomIn}
            ariaLabel="zoom-in"
          />
        </ToolbarGroup>
      ) : null}

      {enabled.rotate ? (
        <ToolbarIconButton
          icon={RotateCw}
          label="旋转"
          disabled={!canOperate}
          popupContainer={popupContainer}
          onClick={onRotate}
          ariaLabel="rotate"
        />
      ) : null}

      {enabled.download ? (
        <ToolbarIconButton
          icon={Download}
          label="下载"
          disabled={downloadDisabled}
          popupContainer={popupContainer}
          onClick={onDownload}
          ariaLabel="download"
        />
      ) : null}

      {enabled.fullscreen ? (
        <ToolbarIconButton
          icon={fullscreen ? Minimize : Maximize}
          label={fullscreen ? "退出全屏" : "全屏"}
          disabled={!canOperate}
          popupContainer={popupContainer}
          onClick={onToggleFullscreen}
          ariaLabel="toggle-fullscreen"
        />
      ) : null}

      {extra ? (
        <div className="ml-auto flex items-center gap-1.5">{extra}</div>
      ) : null}
    </div>
  );
};

PdfToolbar.displayName = "PdfToolbar";

export default PdfToolbar;

function ToolbarGroup({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex divide-x divide-border overflow-hidden rounded-md border bg-background shadow-sm">
      {children}
    </div>
  );
}

interface ToolbarIconButtonProps {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  popupContainer?: HTMLElement | null;
  ariaLabel?: string;
}

function ToolbarIconButton({
  icon: Icon,
  label,
  disabled,
  onClick,
  popupContainer,
  ariaLabel,
}: ToolbarIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onClick}
          aria-label={ariaLabel ?? label}
          className="size-7 rounded-none p-0"
        >
          <Icon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent container={popupContainer}>{label}</TooltipContent>
    </Tooltip>
  );
}

interface PageInputProps {
  value: number;
  numPages: number;
  disabled: boolean;
  onCommit: (page: number) => void;
}

function PageInput({ value, numPages, disabled, onCommit }: PageInputProps) {
  const [draft, setDraft] = useState<string>(String(value));
  const [editing, setEditing] = useState(false);

  // 外部 value 变化时（翻页 / 跳转）同步 draft，同时不打断当前编辑会话
  if (!editing && draft !== String(value)) {
    setDraft(String(value));
  }

  const commit = () => {
    setEditing(false);
    const parsed = Number.parseInt(draft, 10);
    if (
      !Number.isFinite(parsed) ||
      parsed < 1 ||
      (numPages > 0 && parsed > numPages)
    ) {
      setDraft(String(value));
      return;
    }
    if (parsed !== value) onCommit(parsed);
    else setDraft(String(value));
  };

  return (
    <div className="inline-flex h-7 items-center gap-1 px-1 text-xs">
      <Input
        type="text"
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        aria-label="page-input"
        className="h-6 w-10 rounded-sm border-none bg-transparent px-1 py-0 text-center font-mono text-xs shadow-none focus-visible:ring-1"
        onFocus={() => setEditing(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(String(value));
            setEditing(false);
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
      <span className="font-mono text-muted-foreground">
        / {numPages || "-"}
      </span>
    </div>
  );
}

export const resolveToolbarConfig = (
  toolbar: boolean | PdfToolbarConfig | undefined,
): Required<PdfToolbarConfig> => {
  if (toolbar === false) {
    return {
      pageNav: false,
      zoom: false,
      rotate: false,
      download: false,
      fullscreen: false,
      outline: false,
      thumbnail: false,
    };
  }
  if (toolbar === undefined || toolbar === true) {
    return { ...DEFAULT_TOOLBAR_CONFIG };
  }
  return { ...DEFAULT_TOOLBAR_CONFIG, ...toolbar };
};

export const isToolbarVisible = (
  config: Required<PdfToolbarConfig>,
): boolean => {
  return (
    config.pageNav ||
    config.zoom ||
    config.rotate ||
    config.download ||
    config.fullscreen ||
    config.outline ||
    config.thumbnail
  );
};
