import { canvasGetProject } from "@repo/api/canvas";
import { Button } from "@repo/design-system";
import { ChevronLeft as IconLeft } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";

import t from "@/utils/i18n";

import styles from "./index.module.css";

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
          onClick={() => navigate("/platform/canvas/projects")}
          size="xs"
          variant="outline"
        >
          <IconLeft className="text-sm" />
        </Button>
        <h1 className="m-0 text-xl font-semibold leading-7 text-foreground">{projectName || t("项目")}</h1>
        {summary ? <span className="shrink-0 text-xl leading-7 text-muted-foreground">{summary}</span> : null}
      </header>
      <ProjectLayoutContext.Provider value={contextValue}>
        <Outlet />
      </ProjectLayoutContext.Provider>
    </main>
  );
}
