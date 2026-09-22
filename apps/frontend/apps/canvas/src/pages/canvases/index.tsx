import { canvasListCanvases } from "@repo/api";
import { useInfiniteScroll } from "ahooks";
import {
  RefreshCw as IconRefresh,
  Clock3 as IconClockCircle,
  EllipsisVertical as IconMoreVertical1,
  Plus as IconPlus,
  Sparkles,
  Video as IconVideoDefault,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import emptyIllustration from "@/assets/storyboard-empty.png";
import {
  EllipsisText as CEllipsis,
  OperationMenu as COperationMenu,
  Result,
  UserLabel as UserAuto,
  openDeleteConfirmDialog,
  formatDateByCurrentYear,
} from "@/components/compat";
import { Spin, Button } from "@/components/ui";
import type { canvas } from "@/domain";
import { resolveArtifactURL } from "@/utils/artifactURL";
import t from "@/utils/i18n";

import { FilterTabs } from "../../components/FilterTabs";
import { SearchInput } from "../../components/SearchInput";
import { SortControl } from "../../components/SortControl";
import { ProjectCoverImage } from "../administration/ProjectCover";
import { useProjectLayoutSummary } from "../projectLayout/index";
import { type CanvasDialogState, deleteCanvas } from "./actions";
import { CanvasDialog } from "./CanvasDialog";
import { formatDurationMillis } from "./model";

import styles from "./index.module.less";

const VIDEO_PAGE_SIZE = 20;
const KEYWORD_DEBOUNCE_MILLIS = 300;
const VIDEO_UPDATED_AT_FORMAT = {
  currentYearFormat: "MM-DD HH:mm",
  nonCurrentYearFormat: "YYYY-MM-DD HH:mm",
};
const VIDEO_SORT_OPTIONS = [{ label: t("更新时间"), value: "updatedAt" }];

function getCanvasPath(projectId: string, canvasId: string) {
  return `/platform/canvas/projects/${projectId}/studio/${canvasId}`;
}

interface CanvasPage {
  hasMore: boolean;
  list: canvas.ProjectCanvasSummary[];
  pageNum: number;
  total: number;
}

function CanvasCard({
  item,
  projectId,
  onMake,
  onEdit,
  onDelete,
}: {
  item: canvas.ProjectCanvasSummary;
  projectId: string;
  onMake: (item: canvas.ProjectCanvasSummary) => void;
  onEdit: (item: canvas.ProjectCanvasSummary) => void;
  onDelete: (item: canvas.ProjectCanvasSummary) => void;
}) {
  const hasVideo = item.Stats.SelectedVideoDurationMillis > 0;
  const coverImagePath = item.CoverImageURL;
  const fallbackCoverImageURL = resolveArtifactURL(item.FallbackCoverImageURL ?? "");

  return (
    <article className="group relative w-full overflow-hidden rounded-[16px] border border-[transparent] border-solid p-[3px] transition-colors duration-200 hover:border-[#000000]">
      <Link
        aria-label={t("进入创意工坊：{name}", { name: item.Name })}
        className="flex flex-col gap-4 text-inherit no-underline"
        to={getCanvasPath(projectId, item.CanvasID)}
      >
        <div className={`relative aspect-video w-full overflow-hidden rounded-[12px] ${styles.cardCover}`}>
          {coverImagePath ? (
            <ProjectCoverImage
              alt={item.Name}
              className={styles.cardCoverImage}
              path={coverImagePath}
              version={String(item.Revision)}
            />
          ) : fallbackCoverImageURL ? (
            <img alt={item.Name} className={styles.cardCoverImage} loading="lazy" src={fallbackCoverImageURL} />
          ) : (
            <div className="flex h-full items-center justify-center text-[32px] text-muted-foreground">
              <span className="relative inline-flex">
                <IconVideoDefault />
                <Sparkles className="absolute -right-1 -top-1 size-3 fill-current" />
              </span>
            </div>
          )}
          <span className="absolute bottom-2 left-2 inline-flex h-6 items-center gap-1 rounded-[8px] bg-[rgba(0,0,0,0.5)] px-[6px] text-[13px] font-medium leading-5.5 text-white">
            <IconClockCircle className="text-[14px]" />
            {hasVideo ? formatDurationMillis(item.Stats.SelectedVideoDurationMillis) : "--:--"}
          </span>
        </div>
        <div className="flex flex-col gap-1 px-3">
          <h2 className="m-0 flex items-center text-[18px] font-medium leading-7 text-foreground group-hover:text-primary">
            <CEllipsis className="min-w-0 flex-1">{item.Name}</CEllipsis>
          </h2>
          <div className="flex items-center gap-1 truncate text-[13px] leading-5.5 text-muted-foreground">
            <UserAuto id={item.CreatedBy} prefix="@" showIcon={false} stableSign />
            <span>·</span>
            <CEllipsis className="min-w-0 flex-1">
              <time>
                {t("更新时间")} {formatDateByCurrentYear(item.UpdatedAt, VIDEO_UPDATED_AT_FORMAT)}
              </time>
            </CEllipsis>
          </div>
        </div>
      </Link>
      <div className="relative mt-3 px-3 pb-4">
        <div className="flex h-6 items-center gap-2 text-[13px] font-medium leading-5.5 text-foreground group-hover:opacity-0 group-focus-within:opacity-0">
          <span>{t("{count} 个分镜", { count: item.Stats.CanvasNodeCount })}</span>
        </div>
        <div className={styles.cardOperations}>
          <COperationMenu
            className={styles.cardOperationMenu}
            displayNum={1}
            defaultButtonType="outline"
            spaceSize={8}
            buttonProps={{ size: "mini" }}
            menuButtonProps={{
              icon: <IconMoreVertical1 />,
              size: "mini",
              type: "outline",
            }}
            operations={[
              { name: t("视频制作"), onClick: () => onMake(item) },
              { name: t("编辑"), onClick: () => onEdit(item) },
              {
                name: t("删除"),
                buttonProps: { status: "danger" },
                onClick: () => onDelete(item),
              },
            ]}
          />
        </div>
      </div>
    </article>
  );
}

export default function CanvasesPage() {
  const navigate = useNavigate();
  const { projectId = "" } = useParams();
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [ascending, setAscending] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [sortKey, setSortKey] = useState("updatedAt");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [dialogState, setDialogState] = useState<CanvasDialogState>();
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = () => setRefreshVersion((value) => value + 1);
  const handleDelete = (item: canvas.ProjectCanvasSummary) => {
    openDeleteConfirmDialog({
      name: t("剧集"),
      targetName: item.Name,
      info: <span className="block px-6">{t("删除剧集后不可恢复，请谨慎操作。")}</span>,
      className: "w-[400px]! max-w-[calc(100vw-48px)]!",
      async onOk() {
        await deleteCanvas(projectId, item.CanvasID);
        refresh();
      },
    });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword), KEYWORD_DEBOUNCE_MILLIS);

    return () => window.clearTimeout(timer);
  }, [keyword]);

  const { data, error, loading, loadingMore } = useInfiniteScroll<CanvasPage>(
    async (currentPage) => {
      const pageNum = (currentPage?.pageNum ?? 0) + 1;
      const normalizedKeyword = debouncedKeyword.trim();
      const raw = await canvasListCanvases(projectId, {
        keyword: normalizedKeyword || undefined,
        created_by_me: onlyMine || undefined,
        sort_direction: ascending ? "ASC" : "DESC",
        page_size: VIDEO_PAGE_SIZE,
        page_num: pageNum,
      });
      const items = raw.items.map((item) => ({
        CanvasID: item.canvas_id,
        ProjectID: item.project_id,
        Name: item.name,
        CoverImagePath: item.cover_image_path,
        CoverImageURL: item.cover_image_url,
        CreatedBy: item.created_by,
        CreatedAt: item.created_at,
        UpdatedAt: item.updated_at,
        Stats: {
          CanvasNodeCount: item.stats.canvas_node_count,
          SelectedVideoDurationMillis: item.stats.selected_video_duration_millis,
        },
        FallbackCoverImageURL: item.fallback_cover_image_url,
        DefaultView: item.default_view,
        Revision: item.revision,
      }));

      return {
        hasMore: pageNum * VIDEO_PAGE_SIZE < raw.page.total,
        list: items,
        pageNum,
        total: raw.page.total,
      };
    },
    {
      target: scrollRef,
      isNoMore: (page) => !page?.hasMore,
      reloadDeps: [ascending, debouncedKeyword, onlyMine, projectId, refreshVersion, sortKey],
    },
  );

  const canvases = data?.list ?? [];
  const canvasTotal = data?.total ?? 0;
  const loadFailed = Boolean(error) && canvases.length === 0;
  useProjectLayoutSummary(t("共 {canvasTotal} 视频", { canvasTotal }));

  return (
    <section
      aria-label={t("视频创作列表页")}
      className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-3 ${styles.workspace}`}
    >
      <div
        aria-label={t("视频列表工具栏")}
        className="mb-6 flex flex-none flex-wrap items-center justify-between gap-3"
        role="toolbar"
      >
        <div className="flex flex-wrap items-center gap-2">
          <FilterTabs
            ariaLabel={t("视频范围")}
            onChange={setOnlyMine}
            options={[
              { label: t("全部"), value: false },
              { label: t("由我创建"), value: true },
            ]}
            value={onlyMine}
          />
          <SortControl
            ariaLabel={t("视频排序")}
            ascending={ascending}
            onAscendingChange={setAscending}
            onValueChange={setSortKey}
            options={VIDEO_SORT_OPTIONS}
            value={sortKey}
          />
          <SearchInput
            className={styles.toolbarSearchInput}
            onChange={setKeyword}
            placeholder={t("输入视频名称搜索")}
            value={keyword}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button icon={<IconPlus />} onClick={() => setDialogState({ mode: "create" })} size="default" type="primary">
            {t("创建视频")}
          </Button>
          <Button
            aria-label={t("刷新视频")}
            data-ea="video-list-refresh"
            icon={
              <span className={loading ? "animate-spin" : ""}>
                <IconRefresh />
              </span>
            }
            onClick={refresh}
            title={t("刷新视频")}
          />
        </div>
      </div>

      <div aria-label={t("视频列表内容")} className="min-h-0 flex-1 overflow-y-auto" ref={scrollRef} role="region">
        {loading ? (
          <div className="flex h-full min-h-[320px] items-center justify-center">
            <Spin />
          </div>
        ) : loadFailed ? (
          <Result
            status="error"
            title={t("视频加载失败")}
            subTitle={t("请稍后重试")}
            extra={<Button onClick={() => setRefreshVersion((value) => value + 1)}>{t("重新加载")}</Button>}
          />
        ) : canvases.length > 0 ? (
          <div className={`grid grid-cols-5 ${styles.cardGrid}`}>
            {canvases.map((item) => (
              <CanvasCard
                item={item}
                key={item.CanvasID}
                onDelete={handleDelete}
                onMake={(canvasItem) => navigate(getCanvasPath(projectId, canvasItem.CanvasID))}
                onEdit={(canvasItem) => setDialogState({ mode: "edit", canvas: canvasItem })}
                projectId={projectId}
              />
            ))}
          </div>
        ) : keyword.trim() ? (
          <Result status="404" title={t("没有找到相关视频")} subTitle={t("请尝试其他关键词")} />
        ) : (
          <div className="mt-[110px] flex flex-col items-center gap-[10px]">
            <img alt={t("项目暂无视频")} className="h-[320px] w-[320px] object-contain" src={emptyIllustration} />
            <p className="m-0 text-[20px] font-medium leading-8 text-foreground">{t("方寸之间，万物生长")}</p>
          </div>
        )}
        {canvases.length > 0 && loadingMore ? (
          <div className={styles.loadMore}>
            <Spin />
          </div>
        ) : null}
      </div>
      <CanvasDialog
        onClose={() => setDialogState(undefined)}
        onSuccess={refresh}
        projectId={projectId}
        state={dialogState}
      />
    </section>
  );
}
