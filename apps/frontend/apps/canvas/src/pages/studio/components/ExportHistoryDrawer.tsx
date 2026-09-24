import {
  canvasListArchives,
  fetchCanvasArchiveContent,
  CanvasVideoArchiveExportStatus,
  type CanvasProjectCanvasVideoArchiveExport,
} from "@repo/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/design-system";
import {
  History as IconAgentHistory,
  Download as IconDownloadFine,
  CircleAlert as IconExclamationCircleRedFill,
  LoaderCircle as IconLoading,
  FileArchive as IconZip,
} from "lucide-react";

import { ActionButton } from "@/components/ActionButton";
import { FileList, type FileListPage } from "@/components/FileList/FileList";
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
      <Tooltip>
        <TooltipTrigger
          render={
            <span aria-label={t("打包中")} className="inline-flex size-5 items-center justify-center text-primary">
              <IconLoading className="animate-spin text-[16px]" />
            </span>
          }
        />
        <TooltipContent side={"left"}>{t("打包中")}</TooltipContent>
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
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              aria-label={cancelled ? t("打包已取消") : t("打包失败")}
              className="inline-flex size-5 items-center justify-center text-destructive"
            >
              <IconExclamationCircleRedFill className="text-[20px]" />
            </span>
          }
        />
        <TooltipContent side={"left"}>{message}</TooltipContent>
      </Tooltip>
    );
  }

  const expired = !item.path;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
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
      </TooltipTrigger>
      <TooltipContent side={"left"}>{expired ? t("下载链接已过期") : t("下载")}</TooltipContent>
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
    <Sheet open={visible} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="canvas-web-theme w-[min(440px,95vw)] sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <IconAgentHistory className="text-[20px]" />
            <span>{t("导出记录")}</span>
          </SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
