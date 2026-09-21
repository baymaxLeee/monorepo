import { fetchModelProviders, type ModelProvider } from "@repo/api";
import { atom, useAtomValue, useStore } from "jotai";
import { useEffect } from "react";

import { canvasGraphAtom } from "../store/graph";

const modelsAtom = atom<{
  projectId: string;
  items: ModelProvider[];
  state: "idle" | "loading" | "loaded" | "failed";
}>({ projectId: "", items: [], state: "idle" });

export function useCreativeModels() {
  const store = useStore();
  const graph = useAtomValue(canvasGraphAtom);
  const result = useAtomValue(modelsAtom);
  const projectId = graph?.canvas.project_id ?? "";
  useEffect(() => {
    if (!projectId) return;
    const current = store.get(modelsAtom);
    if (current.projectId === projectId && current.state !== "idle") return;
    store.set(modelsAtom, { projectId, items: [], state: "loading" });
    void fetchModelProviders({ skipErrorNotify: true })
      .then((value) => {
        if (store.get(modelsAtom).projectId === projectId)
          store.set(modelsAtom, { projectId, items: value.filter((provider) => provider.is_enabled), state: "loaded" });
      })
      .catch(() => {
        if (store.get(modelsAtom).projectId === projectId)
          store.set(modelsAtom, { projectId, items: [], state: "failed" });
      });
  }, [projectId, result.state, store]);
  return {
    models: result.items,
    loading: result.state === "idle" || result.state === "loading",
    failed: result.state === "failed",
    retry: () => store.set(modelsAtom, { projectId, items: [], state: "idle" }),
  };
}
