import { canvasDeleteProject, CanvasSortDirection } from "@repo/api";
import { useDebounce, useInfiniteScroll } from "ahooks";
import {
  RefreshCw as IconRefresh,
  Search as IconSearch,
  Clock3 as IconClockCircle,
  EllipsisVertical as IconMoreVertical1,
  Plus as IconPlus,
  Layers3 as IconProjectFill,
  Sparkles,
  Video as IconVideoDefault,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { getProjectForRole, listMyProjects } from "@/api/projectAccess";
import emptyIllustration from "@/assets/storyboard-empty.png";
import {
  EllipsisText as CEllipsis,
  LegacySkeleton as Skeleton,
  OperationMenu as COperationMenu,
  openDeleteConfirmDialog,
  UserLabel as UserAuto,
  formatDateByCurrentYear,
} from "@/components/compat";
import { Spin, Button } from "@/components/ui";
import { project } from "@/domain";
import { useCanManageProjects } from "@/hooks/useCanManageProjects";
import t from "@/utils/i18n";

import { SearchInput } from "../../components/SearchInput";
import { SortControl } from "../../components/SortControl";
import { ProjectCoverImage } from "../administration/ProjectCover";
import { ProjectDialog } from "../administration/ProjectDialog";
import type { ProjectDialogState } from "../administration/types";

import styles from "./index.module.less";

interface Project {
  id: string;
  title: string;
  createdBy: string;
  updatedAt: string;
  videos: number;
  duration: string;
  assets: number;
  thumbnail?: string;
}

interface ProjectPage {
  hasMore: boolean;
  list: Project[];
  pageNum: number;
}

const PAGE_SIZE = 20;
const PROJECT_SORT_OPTIONS = [{ label: t("更新时间"), value: "updatedAt" }];
const PROJECT_UPDATED_AT_FORMAT = {
  currentYearFormat: "MM-DD HH:mm",
  nonCurrentYearFormat: "YYYY-MM-DD HH:mm",
};

function formatDuration(durationMillis: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMillis / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function ProjectCard({
  canManageProject,
  onDelete,
  onEdit,
  project,
}: {
  canManageProject: boolean;
  onDelete: () => void;
  onEdit: () => void;
  project: Project;
}) {
  return (
    <article className="group relative w-full overflow-hidden rounded-[16px] border border-[transparent] border-solid p-[3px] transition-colors duration-200 hover:border-[#000000]">
      <Link
        aria-label={t("进入项目：{title}", { title: project.title })}
        className="flex flex-col gap-4 pb-4 text-inherit no-underline"
        to={`/platform/canvas/projects/${project.id}/canvases`}
      >
        <div
          className={`relative aspect-video w-full overflow-hidden rounded-[12px] bg-[#f2f3f5] ${styles.projectCover}`}
        >
          {project.thumbnail ? (
            <ProjectCoverImage
              alt={project.title}
              className={`h-full w-full object-cover ${styles.projectCoverImage}`}
              path={project.thumbnail}
              version={project.updatedAt}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[32px] text-muted-foreground">
              <span className="relative inline-flex">
                <IconVideoDefault />
                <Sparkles className="absolute -right-1 -top-1 size-3 fill-current" />
              </span>
            </div>
          )}
          <span className="absolute bottom-2 left-2 inline-flex h-6 items-center rounded-[8px] bg-[rgba(0,0,0,0.5)] px-[6px] text-[13px] font-medium leading-5.5 text-white">
            {t("{count} 个视频", { count: project.videos })}
          </span>
        </div>

        <div className="flex flex-col gap-1 px-3">
          <h2 className="m-0 min-w-0 text-[18px] font-medium leading-7 text-foreground group-hover:text-primary">
            <CEllipsis showPopover="auto" className={`w-full ${styles.projectTitle}`}>
              {project.title}
            </CEllipsis>
          </h2>
          <div className="flex items-center gap-1 truncate text-[13px] leading-5.5 text-muted-foreground">
            <UserAuto id={project.createdBy} stableSign={true} prefix="@" showIcon={false} />
            <span>·</span>
            <CEllipsis className="min-w-0 flex-1">
              <time>
                {t("更新时间")} {formatDateByCurrentYear(project.updatedAt, PROJECT_UPDATED_AT_FORMAT)}
              </time>
            </CEllipsis>
          </div>
        </div>
        <div className="flex h-6 items-center gap-3 px-3">
          <span className="inline-flex items-center gap-1 rounded-[8px] border border-border bg-[rgba(26,27,30,0.05)] px-[6px] text-[13px] leading-5.5 text-[#676b72] group-hover:opacity-0 group-focus-within:opacity-0">
            <IconClockCircle className="text-[14px]" />
            {project.duration}
          </span>
          <span className="inline-flex items-center gap-1 rounded-[8px] border border-border bg-[rgba(26,27,30,0.05)] px-[6px] text-[13px] leading-5.5 text-[#676b72] group-hover:opacity-0 group-focus-within:opacity-0">
            <IconProjectFill className="text-[14px]" />
            {t("{count} 个资产", { count: project.assets })}
          </span>
        </div>
      </Link>
      <div className={styles.cardOperations}>
        <COperationMenu
          className={styles.cardOperationMenu}
          defaultButtonType="outline"
          displayNum={1}
          menuButtonProps={{
            icon: <IconMoreVertical1 />,
            size: "mini",
            type: "outline",
          }}
          operations={[
            { name: t("编辑"), onClick: onEdit },
            ...(canManageProject
              ? [{ name: t("删除"), buttonProps: { status: "danger" as const }, onClick: onDelete }]
              : []),
          ]}
          spaceSize={8}
          buttonProps={{ size: "mini" }}
        />
      </div>
    </article>
  );
}

function ProjectCardSkeleton() {
  return (
    <div aria-hidden className="min-w-0 rounded-[12px] bg-white p-2">
      <Skeleton
        animation
        className="aspect-video w-full shrink-0"
        image={{
          style: {
            width: "100%",
            height: "100%",
            marginRight: 0,
            borderRadius: 12,
          },
        }}
        text={false}
      />
      <Skeleton animation className="mt-3" text={{ rows: 4, width: ["72%", "92%", "48%", "64%"] }} />
    </div>
  );
}

export default function ProjectsPage() {
  const [keyword, setKeyword] = useState("");
  const [ascending, setAscending] = useState(false);
  const [sortKey, setSortKey] = useState("updatedAt");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [dialogState, setDialogState] = useState<ProjectDialogState>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const debouncedKeyword = useDebounce(keyword, { wait: 300 });
  const canManageProjects = useCanManageProjects();

  const { data, loading, loadingMore } = useInfiniteScroll<ProjectPage>(
    async (currentPage) => {
      const pageNum = (currentPage?.pageNum ?? 0) + 1;
      const response = await listMyProjects({
        Filter: debouncedKeyword.trim() ? { Keyword: debouncedKeyword.trim() } : undefined,
        Sort: {
          Field: project.ProjectSortField.UPDATED_AT,
          Direction: ascending ? CanvasSortDirection.ASC : CanvasSortDirection.DESC,
        },
        Page: { PageSize: PAGE_SIZE, PageNum: pageNum },
      });

      return {
        hasMore: pageNum * PAGE_SIZE < response.Page.Total,
        list: response.Items.map((item) => ({
          id: item.ProjectID,
          title: item.Name,
          createdBy: item.CreatedBy,
          updatedAt: item.UpdatedAt,
          videos: item.Stats.CanvasCount,
          duration: formatDuration(item.Stats.SelectedVideoDurationMillis),
          assets: item.Stats.ResourceCount,
          thumbnail: item.CoverImageURL,
        })),
        pageNum,
      };
    },
    {
      target: scrollRef,
      isNoMore: (page) => !page?.hasMore,
      reloadDeps: [ascending, canManageProjects, debouncedKeyword, refreshVersion, sortKey],
    },
  );

  const projects = data?.list ?? [];

  const handleRefresh = () => {
    setRefreshVersion((value) => value + 1);
  };

  const handleEdit = async (projectID: string) => {
    const response = await getProjectForRole(canManageProjects, { ProjectID: projectID });
    setDialogState({ mode: "edit", project: response.Project });
  };

  const handleDelete = (project: Project) => {
    openDeleteConfirmDialog({
      name: t("项目"),
      targetName: project.title,
      info: <span className="block px-6">{t("删除项目后不可恢复，请谨慎操作。")}</span>,
      className: "w-[400px]! max-w-[calc(100vw-48px)]!",
      async onOk() {
        await canvasDeleteProject(project.id);
        handleRefresh();
      },
    });
  };

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <header className="shrink-0 px-5 pb-3 pt-4">
        <h1 className="m-0 text-[28px] font-semibold leading-10 text-foreground">{t("下午好，导演！")}</h1>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <SortControl
              ariaLabel={t("项目排序")}
              ascending={ascending}
              onAscendingChange={setAscending}
              onValueChange={setSortKey}
              options={PROJECT_SORT_OPTIONS}
              value={sortKey}
            />

            <SearchInput
              className="w-[240px] max-w-full"
              onChange={setKeyword}
              placeholder={t("输入关键词搜索")}
              value={keyword}
            />
          </div>

          <div className="flex items-center gap-3">
            {canManageProjects ? (
              <Button icon={<IconPlus />} onClick={() => setDialogState({ mode: "create" })} type="primary">
                {t("创建项目")}
              </Button>
            ) : null}
            <Button
              aria-label={t("刷新项目")}
              data-ea="project-list-refresh"
              icon={
                <span className={loading ? "animate-spin" : ""}>
                  <IconRefresh />
                </span>
              }
              onClick={handleRefresh}
              title={t("刷新项目")}
            />
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {loading ? (
          <section aria-label={t("正在加载项目")} className={`grid ${styles.projectGrid}`}>
            {Array.from({ length: 4 }, (_, index) => (
              <ProjectCardSkeleton key={index} />
            ))}
          </section>
        ) : projects.length > 0 ? (
          <section aria-label={t("项目列表")} className={`grid ${styles.projectGrid}`}>
            {projects.map((project) => (
              <ProjectCard
                canManageProject={canManageProjects}
                key={project.id}
                onDelete={() => handleDelete(project)}
                onEdit={() => void handleEdit(project.id)}
                project={project}
              />
            ))}
          </section>
        ) : debouncedKeyword.trim() ? (
          <section className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-[16px] bg-white text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <IconSearch className="text-[18px]" />
            </div>
            <p className="mb-0 mt-4 text-[16px] font-medium text-foreground">{t("没有找到相关项目")}</p>
            <p className="mb-0 mt-1 text-[13px] text-muted-foreground">{t("换个关键词再试试")}</p>
          </section>
        ) : (
          <section className="mt-[110px] flex flex-col items-center gap-[10px]">
            <img alt={t("暂无项目")} className="h-[320px] w-[320px] object-contain" src={emptyIllustration} />
            <p className="m-0 text-[20px] font-medium leading-8 text-foreground">{t("方寸之间，万物生长")}</p>
          </section>
        )}
        {projects.length > 0 && loadingMore ? (
          <div className={styles.loadMore}>
            <Spin />
          </div>
        ) : null}
      </div>
      <ProjectDialog
        memberOnlyEdit={!canManageProjects}
        state={dialogState}
        onClose={() => setDialogState(undefined)}
        onSuccess={handleRefresh}
      />
    </main>
  );
}
