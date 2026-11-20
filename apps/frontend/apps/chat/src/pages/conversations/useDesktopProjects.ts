import type { DesktopBridge } from "@repo/runtime/desktop";
import { getErrorMessage } from "@repo/shared";
import { useCallback, useEffect, useState } from "react";

export function useDesktopProjects(bridge: DesktopBridge | null, onError: (message: string | null) => void) {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [selectingProject, setSelectingProject] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge
      .listThreads()
      .then((threads) => {
        if (cancelled) return;
        const existing = [...new Set(threads.map((thread) => thread.workspace))];
        setProjects(existing);
        setProject((current) => current ?? existing[0] ?? null);
      })
      .catch((cause) => {
        if (!cancelled) onError(getErrorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, onError]);

  const createProject = useCallback(async () => {
    if (!bridge || selectingProject) return;
    setSelectingProject(true);
    onError(null);
    try {
      const selected = await bridge.selectWorkspace();
      if (!selected) return;
      setProjects((current) => [selected, ...current.filter((item) => item !== selected)]);
      setProject(selected);
    } catch (cause) {
      onError(getErrorMessage(cause));
    } finally {
      setSelectingProject(false);
    }
  }, [bridge, onError, selectingProject]);

  return { projects, project, setProject, selectingProject, createProject };
}
