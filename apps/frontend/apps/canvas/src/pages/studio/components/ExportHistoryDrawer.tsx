import { canvasListArchives, canvasArchiveContent, type CanvasArchive } from "@repo/api";
import {
  History as IconAgentHistory,
  Download as IconDownloadFine,
  CircleAlert as IconExclamationCircleRedFill,
  LoaderCircle as IconLoading,
  FileArchive as IconZip,
} from "lucide-react";

import { ActionButton } from "@/components/ActionButton";
import { FileList, type FileListPage } from "@/components/FileList/FileList";
import { Drawer, Tooltip } from "@/components/ui";
import { saveBlob } from "@/utils/download";
import t from "@/utils/i18n";

const PAGE_SIZE = 10;

type ExportItem = CanvasArchive;

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function formatBytes(size: number) {
  if (size <= 0) {
    return "-";
  }
  const units = ["B", "KiB", "MiB", "GiB"];
  const unitIndex = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / 1024 ** unitIndex;
  return `${Number(value.toFixed(2))} ${units[unitIndex]}`;
}

function isActive(item: ExportItem) {
  return item.status === "queued" || item.status === "running";
}

function ExportStatusAction({ item, canvasId }: { item: ExportItem; canvasId: string }) {
  if (isActive(item)) {
    return (
      <Tooltip content={t("打包中")} position="left">
        <span
          aria-label={t("打包中")}
          className="inline-flex size-5 items-center justify-center text-[color:rgb(var(--primary-6))]"
        >
          <IconLoading className="animate-spin text-[16px]" />
        </span>
      </Tooltip>
    );
  }

  if (item.status === "failed" || item.status === "cancelled") {
    const message = item.status === "cancelled" ? t("打包已取消") : item.error || t("打包失败");
    return (
      <Tooltip content={message} position="left">
        <span
          aria-label={item.status === "cancelled" ? t("打包已取消") : t("打包失败")}
          className="inline-flex size-5 items-center justify-center text-[color:rgb(var(--danger-6))]"
        >
          <IconExclamationCircleRedFill className="text-[20px]" />
        </span>
      </Tooltip>
    );
  }

  const expired = !item.downloadable;
  return (
    <Tooltip content={expired ? t("下载链接已过期") : t("下载")} position="left">
      <span>
        <ActionButton
          ariaLabel={expired ? t("下载链接已过期") : t("下载")}
          disabled={expired}
          icon={<IconDownloadFine />}
          onClick={() => {
            if (!item.downloadable) {
              return;
            }
            void canvasArchiveContent(canvasId, item.id)
              .then((blob) => saveBlob(blob, item.filename))
              .catch(() => undefined);
          }}
          size={28}
          square
        />
      </span>
    </Tooltip>
  );
}

export function ExportHistoryDrawer({
  canvasId,
  onClose,
  projectId,
  visible,
}: {
  canvasId: string;
  onClose: () => void;
  projectId: string;
  visible: boolean;
}) {
  const loadPage = async (pageNum: number, pageSize: number): Promise<FileListPage<ExportItem>> => {
    const result = await canvasListArchives(canvasId);
    const items = [...result.items].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return {
      hasMore: pageNum * pageSize < items.length,
      items: items.slice((pageNum - 1) * pageSize, pageNum * pageSize),
    };
  };

  return (
    <Drawer
      bodyStyle={{ overflow: "hidden", padding: 0 }}
      footer={null}
      onCancel={onClose}
      title={
        <span className="flex items-center gap-2 text-[16px] font-medium leading-6 text-[color:var(--color-text-1)]">
          <IconAgentHistory className="text-[20px]" />
          <span>{t("导出记录")}</span>
        </span>
      }
      unmountOnExit
      visible={visible}
      width={440}
      wrapClassName="agentframe-web-theme"
    >
      <FileList
        emptyText={t("暂无导出记录")}
        errorText={t("导出记录加载失败")}
        getItemKey={(item) => item.id}
        loadPage={loadPage}
        pageSize={PAGE_SIZE}
        renderAction={(item) => <ExportStatusAction item={item} canvasId={canvasId} />}
        renderDescription={(item) => (
          <>
            <span>{t("{count} 个分镜", { count: item.input_count })}</span>
            <span>{formatBytes(item.size)}</span>
          </>
        )}
        renderIcon={() => <IconZip className="text-[28px] text-[color:rgb(var(--primary-6))]" />}
        renderTitle={(item) => formatDateTime(item.created_at)}
        retryText={t("重新加载")}
        sourceKey={`${projectId}:${canvasId}:${visible}`}
      />
    </Drawer>
  );
}
