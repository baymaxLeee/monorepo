import {
  Button,
  Dropdown,
  InputNumber,
  Menu,
  Space,
  Tooltip,
} from "../../compat/legacy-ui";
import {
  IconDownload,
  IconFullscreen,
  IconFullscreenExit,
  IconLeft,
  IconMenu,
  IconMinus,
  IconPlus,
  IconRight,
  IconSync,
} from "../../compat/legacy-icons";
import { type ReactNode, useMemo } from "react";
import { slotClassNameFactory } from "../../compat/className";
import type { PdfSidebarType, PdfToolbarConfig } from "../interface";

const cssPrefix = slotClassNameFactory("pdf-previewer");

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
  getPopupContainer: () => HTMLElement;
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
  getPopupContainer,
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

  const sidebarDropdown = useMemo(
    () => (
      <Menu
        className={cssPrefix`toolbar-sidebar-menu`}
        selectedKeys={[sidebarType ?? "none"]}
        onClickMenuItem={(key) => {
          const next = key as SidebarMenuKey;
          onSetSidebar(next === "none" ? null : next);
        }}
      >
        {sidebarPresets.map((preset) => (
          <Menu.Item key={preset.key}>{preset.label}</Menu.Item>
        ))}
      </Menu>
    ),
    [sidebarPresets, sidebarType, onSetSidebar],
  );

  const zoomDropdown = useMemo(
    () => (
      <Menu
        className={cssPrefix`toolbar-zoom-menu`}
        onClickMenuItem={(key) => {
          if (key.startsWith("page-")) {
            onFit(key as "page-width" | "page-height" | "page-fit");
          } else {
            onSetScale(Number(key));
          }
        }}
      >
        {FIT_PRESETS.map((preset) => (
          <Menu.Item key={preset.key}>{preset.label}</Menu.Item>
        ))}
        <div className={cssPrefix`toolbar-divider`} />
        {ZOOM_PRESETS.map((value) => (
          <Menu.Item key={String(value)}>{Math.round(value * 100)}%</Menu.Item>
        ))}
      </Menu>
    ),
    [onFit, onSetScale],
  );

  const atFirstPage = currentPage <= 1;
  const atLastPage = numPages > 0 ? currentPage >= numPages : true;
  const atMinScale = scale <= minScale + 1e-4;
  const atMaxScale = scale >= maxScale - 1e-4;

  return (
    <div
      className={cssPrefix`toolbar`}
      data-testid="pdf-toolbar"
      role="toolbar"
    >
      <Space size={6} align="center">
        {enabled.outline || enabled.thumbnail ? (
          <Tooltip content="侧边栏" getPopupContainer={getPopupContainer}>
            <Dropdown
              droplist={sidebarDropdown}
              trigger="click"
              position="bottom"
              disabled={!canOperate}
              getPopupContainer={getPopupContainer}
            >
              <Button
                size="mini"
                shape="circle"
                icon={<IconMenu />}
                disabled={!canOperate}
                aria-label="toggle-sidebar"
              />
            </Dropdown>
          </Tooltip>
        ) : null}

        {enabled.pageNav ? (
          <Space size={4} align="center">
            <Tooltip content="上一页" getPopupContainer={getPopupContainer}>
              <Button
                size="mini"
                shape="circle"
                icon={<IconLeft />}
                disabled={!canOperate || atFirstPage}
                onClick={onPrevPage}
                aria-label="prev-page"
              />
            </Tooltip>
            <InputNumber
              className={cssPrefix`toolbar-page-input`}
              size="mini"
              mode="button"
              hideControl
              suffix={
                <span className={cssPrefix`toolbar-page-suffix`}>
                  / {numPages || "-"}
                </span>
              }
              min={1}
              max={numPages || 1}
              disabled={!canOperate}
              value={currentPage}
              onChange={(value) => {
                if (typeof value !== "number" || Number.isNaN(value)) return;
                onGoToPage(value);
              }}
            />
            <Tooltip content="下一页" getPopupContainer={getPopupContainer}>
              <Button
                size="mini"
                shape="circle"
                icon={<IconRight />}
                disabled={!canOperate || atLastPage}
                onClick={onNextPage}
                aria-label="next-page"
              />
            </Tooltip>
          </Space>
        ) : null}

        {enabled.zoom ? (
          <Space size={4} align="center">
            <Tooltip content="缩小" getPopupContainer={getPopupContainer}>
              <Button
                size="mini"
                shape="circle"
                icon={<IconMinus />}
                disabled={!canOperate || atMinScale}
                onClick={onZoomOut}
                aria-label="zoom-out"
              />
            </Tooltip>
            <Dropdown
              droplist={zoomDropdown}
              trigger="click"
              position="bottom"
              disabled={!canOperate}
              getPopupContainer={getPopupContainer}
            >
              <Button
                size="mini"
                className={cssPrefix`toolbar-scale`}
                disabled={!canOperate}
              >
                {Math.round(scale * 100)}%
              </Button>
            </Dropdown>
            <Tooltip content="放大" getPopupContainer={getPopupContainer}>
              <Button
                size="mini"
                shape="circle"
                icon={<IconPlus />}
                disabled={!canOperate || atMaxScale}
                onClick={onZoomIn}
                aria-label="zoom-in"
              />
            </Tooltip>
          </Space>
        ) : null}

        {enabled.rotate ? (
          <Tooltip content="旋转" getPopupContainer={getPopupContainer}>
            <Button
              size="mini"
              shape="circle"
              icon={<IconSync />}
              disabled={!canOperate}
              onClick={onRotate}
              aria-label="rotate"
            />
          </Tooltip>
        ) : null}

        {enabled.download ? (
          <Tooltip content="下载" getPopupContainer={getPopupContainer}>
            <Button
              size="mini"
              shape="circle"
              icon={<IconDownload />}
              disabled={downloadDisabled}
              onClick={onDownload}
              aria-label="download"
            />
          </Tooltip>
        ) : null}

        {enabled.fullscreen ? (
          <Tooltip
            content={fullscreen ? "退出全屏" : "全屏"}
            getPopupContainer={getPopupContainer}
          >
            <Button
              size="mini"
              shape="circle"
              icon={fullscreen ? <IconFullscreenExit /> : <IconFullscreen />}
              disabled={!canOperate}
              onClick={onToggleFullscreen}
              aria-label="toggle-fullscreen"
            />
          </Tooltip>
        ) : null}

        {extra}
      </Space>
    </div>
  );
};

PdfToolbar.displayName = "PdfToolbar";

export default PdfToolbar;

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
