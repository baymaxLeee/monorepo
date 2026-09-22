import {
  canvasListArchives,
  fetchCanvasArchiveContent,
  CanvasVideoArchiveExportStatus,
  type CanvasProjectCanvasVideoArchiveExport,
} from "@repo/api";
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

type ExportItem = CanvasProjectCanvasVideoArchiveExport;

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
  return (
    item.status === CanvasVideoArchiveExportStatus.QUEUED || item.status === CanvasVideoArchiveExportStatus.RUNNING
  );
}

function ExportStatusAction({ item, canvasId, projectId }: { item: ExportItem; canvasId: string; projectId: string }) {
  if (isActive(item)) {
    return (
      <Tooltip content={t("打包中")} position="left">
        <span aria-label={t("打包中")} className="inline-flex size-5 items-center justify-center text-primary">
          <IconLoading className="animate-spin text-[16px]" />
        </span>
      </Tooltip>
    );
  }

  if (
    item.status === CanvasVideoArchiveExportStatus.FAILED ||
    item.status === CanvasVideoArchiveExportStatus.CANCELLED
  ) {
    const cancelled = item.status === CanvasVideoArchiveExportStatus.CANCELLED;
    const message = cancelled ? t("打包已取消") : item.error_message || t("打包失败");
    return (
      <Tooltip content={message} position="left">
        <span
          aria-label={cancelled ? t("打包已取消") : t("打包失败")}
          className="inline-flex size-5 items-center justify-center text-destructive"
        >
          <IconExclamationCircleRedFill className="text-[20px]" />
        </span>
      </Tooltip>
    );
  }

  const expired = !item.path;
  return (
    <Tooltip content={expired ? t("下载链接已过期") : t("下载")} position="left">
      <span>
        <ActionButton
          ariaLabel={expired ? t("下载链接已过期") : t("下载")}
          disabled={expired}
          icon={<IconDownloadFine />}
          onClick={() => {
            if (!item.path) {
              return;
            }
            void fetchCanvasArchiveContent(projectId, canvasId, item.task_run_id)
              .then((blob) => saveBlob(blob, item.output_filename))
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
    const result = await canvasListArchives(projectId, canvasId, {
      page_num: pageNum,
      page_size: pageSize,
      sort_direction: "desc",
    });
    return {
      hasMore: pageNum < result.page.total_page,
      items: result.items,
    };
  };

  return (
    <Drawer
      bodyStyle={{ overflow: "hidden", padding: 0 }}
      footer={null}
      onCancel={onClose}
      title={
        <span className="flex items-center gap-2 text-[16px] font-medium leading-6 text-foreground">
          <IconAgentHistory className="text-[20px]" />
          <span>{t("导出记录")}</span>
        </span>
      }
      unmountOnExit
      visible={visible}
      width={440}
      wrapClassName="canvas-web-theme"
    >
      <FileList
        emptyText={t("暂无导出记录")}
        errorText={t("导出记录加载失败")}
        getItemKey={(item) => item.task_run_id}
        loadPage={loadPage}
        pageSize={PAGE_SIZE}
        renderAction={(item) => <ExportStatusAction item={item} canvasId={canvasId} projectId={projectId} />}
        renderDescription={(item) => (
          <>
            <span>{t("{count} 个分镜", { count: item.input_count })}</span>
            <span>{formatBytes(item.output_size)}</span>
          </>
        )}
        renderIcon={() => <IconZip className="text-[28px] text-primary" />}
        renderTitle={(item) => formatDateTime(item.created_at)}
        retryText={t("重新加载")}
        sourceKey={`${projectId}:${canvasId}:${visible}`}
      />
    </Drawer>
  );
}
