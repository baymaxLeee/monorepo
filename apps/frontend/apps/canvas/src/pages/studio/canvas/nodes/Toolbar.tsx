import { NodeToolbar, Position } from "@xyflow/react";
import {
  History as IconAgentHistory,
  ShieldCheck as IconComplianceLine,
  Copy as IconCopyLine,
  Download as IconDownloadFine,
  FolderOpen as IconFolderAssetLibrary,
  Maximize2 as IconUnfold,
} from "lucide-react";
import type { ComponentType, MouseEvent, SVGProps } from "react";

import { Message, Tooltip } from "@/components/ui";
import { canvasnode } from "@/domain";
import t from "@/utils/i18n";

import { useCanvasDragging } from "../useCanvasDragging";

import styles from "../CanvasBoard.module.less";

type ToolbarIcon = ComponentType<SVGProps<SVGSVGElement>>;

export type CanvasNodeTool =
  | "review"
  | "addToLibrary"
  | "copy"
  | "download"
  | "history"
  | "largePreview"
  | "fullscreen";

/**
 * 画布节点顶部工具栏的唯一能力表。节点组件只提供动作与当前数据，
 * 不再自行决定按钮、顺序或样式。
 */
export const CANVAS_NODE_TOOLS: Record<canvasnode.CanvasNodeType, readonly CanvasNodeTool[]> = {
  [canvasnode.CanvasNodeType.IMAGE_ASSET]: ["review", "addToLibrary", "copy", "download"],
  [canvasnode.CanvasNodeType.VIDEO_ASSET]: ["review", "addToLibrary", "copy", "download"],
  [canvasnode.CanvasNodeType.AUDIO_ASSET]: ["review", "addToLibrary", "copy", "download"],
  [canvasnode.CanvasNodeType.TEXT]: ["copy", "download"],
  [canvasnode.CanvasNodeType.IMAGE_GENERATION]: ["review", "addToLibrary", "copy", "download", "history", "fullscreen"],
  [canvasnode.CanvasNodeType.VIDEO_GENERATION]: ["review", "addToLibrary", "copy", "download", "history", "fullscreen"],
  [canvasnode.CanvasNodeType.TEXT_GENERATION]: ["copy", "download", "history", "largePreview"],
};

const TOOL_META: Record<CanvasNodeTool, { icon: ToolbarIcon; label: string }> = {
  review: { icon: IconComplianceLine, label: t("提交合规审核") },
  addToLibrary: { icon: IconFolderAssetLibrary, label: t("添加到资产库") },
  copy: { icon: IconCopyLine, label: t("复制节点") },
  download: { icon: IconDownloadFine, label: t("下载") },
  history: { icon: IconAgentHistory, label: t("历史记录") },
  largePreview: { icon: IconUnfold, label: t("大窗口查看") },
  fullscreen: { icon: IconUnfold, label: t("全屏查看") },
};

const MEDIA_EXTENSION_BY_TYPE: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

function isTextNode(type: canvasnode.CanvasNodeType) {
  return type === canvasnode.CanvasNodeType.TEXT || type === canvasnode.CanvasNodeType.TEXT_GENERATION;
}

function isAssetNode(type: canvasnode.CanvasNodeType) {
  return (
    type === canvasnode.CanvasNodeType.IMAGE_ASSET ||
    type === canvasnode.CanvasNodeType.VIDEO_ASSET ||
    type === canvasnode.CanvasNodeType.AUDIO_ASSET
  );
}

function contentAssetID(item: canvasnode.CanvasNode) {
  return item.CurrentAssetID ?? item.AssetID ?? item.SelectedAssetID;
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || t("未命名节点");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadMedia(url: string, name: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("download failed");
  const blob = await response.blob();
  const urlExtension = new URL(url, window.location.href).pathname.split(".").pop()?.toLowerCase();
  const extension =
    MEDIA_EXTENSION_BY_TYPE[blob.type] || (urlExtension && /^[a-z0-9]{2,5}$/.test(urlExtension) ? urlExtension : "bin");
  downloadBlob(blob, `${safeFileName(name)}.${extension}`);
}

type CanvasNodeToolbarProps = {
  item: canvasnode.CanvasNode;
  mediaURL: string;
  onAddToLibrary: (item: canvasnode.CanvasNode) => void;
  onCopy: (item: canvasnode.CanvasNode) => void;
  onHistory: (item: canvasnode.CanvasNode) => void;
  onLargePreview: (item: canvasnode.CanvasNode) => void;
  onReview: (item: canvasnode.CanvasNode) => void;
  textContent: string;
  visible?: boolean;
};

export function CanvasNodeToolbar({
  item,
  mediaURL,
  onAddToLibrary,
  onCopy,
  onHistory,
  onLargePreview,
  onReview,
  textContent,
  visible,
}: CanvasNodeToolbarProps) {
  const dragging = useCanvasDragging();
  if (item.ReferenceStatus === canvasnode.CanvasNodeReferenceStatus.DELETED) {
    return null;
  }
  const textNode = isTextNode(item.Type);
  const assetID = contentAssetID(item);
  const previewValue = textNode ? textContent : mediaURL;
  const tools = CANVAS_NODE_TOOLS[item.Type];

  const run = (action: () => Promise<void>, failure: string) => {
    void action().catch(() => Message.error(t(failure)));
  };

  const unavailable = (tool: CanvasNodeTool) => {
    switch (tool) {
      case "review":
        return !isAssetNode(item.Type) && !assetID;
      case "addToLibrary":
        return (
          !assetID ||
          Boolean(item.ResourceID) ||
          Boolean(item.ResourceAssetID) ||
          item.Type === canvasnode.CanvasNodeType.VIDEO_ASSET ||
          item.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION
        );
      case "copy":
        return false;
      case "download":
      case "largePreview":
      case "fullscreen":
        return !previewValue;
      default:
        return false;
    }
  };

  const activate = (tool: CanvasNodeTool) => {
    switch (tool) {
      case "review":
        onReview(item);
        break;
      case "addToLibrary":
        onAddToLibrary(item);
        break;
      case "copy":
        onCopy(item);
        break;
      case "download":
        run(async () => {
          const name = item.Name || t("节点");
          if (textNode) {
            downloadBlob(new Blob([textContent], { type: "text/markdown;charset=utf-8" }), `${safeFileName(name)}.md`);
          } else {
            await downloadMedia(mediaURL, name);
          }
        }, t("下载失败"));
        break;
      case "history":
        onHistory(item);
        break;
      case "largePreview":
        onLargePreview(item);
        break;
      case "fullscreen": {
        const preview = document.querySelector<HTMLElement>(`[data-canvas-node-preview="${CSS.escape(item.NodeID)}"]`);
        if (preview?.requestFullscreen) {
          run(() => preview.requestFullscreen(), t("无法进入全屏"));
        }
        break;
      }
    }
  };
  return (
    <NodeToolbar
      className={styles.contentNodeToolbar}
      data-canvas-node-id={item.NodeID}
      isVisible={dragging ? false : visible}
      offset={4}
      position={Position.Top}
    >
      {tools.map((tool) => {
        const meta = TOOL_META[tool];
        const Icon = meta.icon;
        const disabled = unavailable(tool);
        return (
          <Tooltip content={t(meta.label)} key={tool} position="top">
            <button
              aria-label={t(meta.label)}
              className="nodrag nopan"
              data-tool={tool}
              disabled={disabled}
              onClick={(event: MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                if (disabled) return;
                activate(tool);
              }}
              type="button"
            >
              <Icon />
            </button>
          </Tooltip>
        );
      })}
    </NodeToolbar>
  );
}
