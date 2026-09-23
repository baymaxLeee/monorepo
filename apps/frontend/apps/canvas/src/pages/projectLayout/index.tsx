import { canvasGetProject } from "@repo/api";
import { Library as IconAssetLibrary, ChevronLeft as IconLeft, Clapperboard as IconVideoCreation } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui";
import t from "@/utils/i18n";

import styles from "./index.module.less";

interface ProjectLayoutContextValue {
  setSummary: (summary: string) => void;
}

const ProjectLayoutContext = createContext<ProjectLayoutContextValue>({
  setSummary: () => undefined,
});

export function useProjectLayoutSummary(summary: string) {
  const { setSummary } = useContext(ProjectLayoutContext);
  useEffect(() => {
    setSummary(summary);
    return () => setSummary("");
  }, [setSummary, summary]);
}

export default function ProjectLayout() {
  const navigate = useNavigate();
  const { projectId = "" } = useParams();
  const [projectName, setProjectName] = useState("");
  const [summary, setSummary] = useState("");
  const contextValue = useMemo(() => ({ setSummary }), []);

  useEffect(() => {
    let active = true;
    canvasGetProject(projectId)
      .then((response) => {
        if (active) setProjectName(response.project.name);
      })
      .catch(() => {
        if (active) setProjectName("");
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  return (
    <main className={`flex h-full min-h-0 flex-col overflow-hidden ${styles.projectLayout}`}>
      <header className="flex shrink-0 items-center gap-3 p-5">
        <Button
          aria-label={t("返回项目")}
          className="flex! items-center! justify-center!"
          icon={<IconLeft className="text-[14px]" />}
          onClick={() => navigate("/platform/canvas/projects")}
          size="mini"
        />
        <h1 className="m-0 text-[20px] font-semibold leading-7 text-foreground">{projectName || t("项目")}</h1>
        {summary ? <span className="shrink-0 text-[20px] leading-7 text-muted-foreground">{summary}</span> : null}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="mt-3 w-[200px] shrink-0 border-0 border-r border-solid border-border px-3 pb-3">
          <nav aria-label={t("项目功能")} className="flex flex-col gap-1">
            <NavLink
              className={({ isActive }) => `${styles.navigation} ${isActive ? styles.selectedNavigation : ""}`}
              to={`/platform/canvas/projects/${projectId}/canvases`}
            >
              <IconVideoCreation aria-hidden size={18} strokeWidth={1.5} />
              {t("视频创作")}
            </NavLink>
            <NavLink
              className={({ isActive }) => `${styles.navigation} ${isActive ? styles.selectedNavigation : ""}`}
              to={`/platform/canvas/projects/${projectId}/resources`}
            >
              <IconAssetLibrary aria-hidden size={18} strokeWidth={1.5} />
              {t("资产库")}
            </NavLink>
          </nav>
        </aside>

        <ProjectLayoutContext.Provider value={contextValue}>
          <Outlet />
        </ProjectLayoutContext.Provider>
      </div>
    </main>
  );
}
