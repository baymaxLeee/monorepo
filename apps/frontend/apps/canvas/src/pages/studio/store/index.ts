import type { CanvasDefaults } from "@repo/api";
import { atom } from "jotai";

import type { ImageGenerationModelOption } from "../../resources/generation/imageModels";
import { DEFAULT_STUDIO_VIEW, type StudioView } from "../domain/types";
import type { VideoModelOption } from "../domain/videoModels";

/** 仅承载创意工坊各模块共享的页面级状态；组件交互态继续留在组件内部。 */
export { canvasArchivesAtom, canvasAtom } from "./canvasGraph";
export const studioReadyAtom = atom(false);
export const studioViewAtom = atom<StudioView>(DEFAULT_STUDIO_VIEW);
export const studioViewChangingAtom = atom(false);
export const assetsPanelOpenAtom = atom(true);
export const canvasLayoutRequestAtom = atom<
  | {
      requestId: number;
      seedNodeIds: string[];
    }
  | undefined
>(undefined);
export const imageModelsAtom = atom<ImageGenerationModelOption[]>([]);
export const textModelsAtom = atom<VideoModelOption[]>([]);
export const videoModelsAtom = atom<VideoModelOption[]>([]);
export const storyboardModelsAtom = atom<VideoModelOption[]>([]);
export const defaultModelsAtom = atom<CanvasDefaults>({});

export const defaultVideoModelIdAtom = atom((get) => {
  const models = get(videoModelsAtom);
  const configuredId = get(defaultModelsAtom).video?.provider_id ?? "";
  return models.some((model) => model.id === configuredId) ? configuredId : (models[0]?.id ?? "");
});

function configuredOrFirst(models: ReadonlyArray<{ id: string }>, configuredId: string) {
  return models.some((model) => model.id === configuredId) ? configuredId : (models[0]?.id ?? "");
}

export const defaultImageModelIdAtom = atom((get) =>
  configuredOrFirst(get(imageModelsAtom), get(defaultModelsAtom).image?.provider_id ?? ""),
);

export const defaultTextModelIdAtom = atom((get) =>
  configuredOrFirst(get(textModelsAtom), get(defaultModelsAtom).inference?.provider_id ?? ""),
);

export const defaultStoryboardModelIdAtom = atom((get) =>
  configuredOrFirst(get(storyboardModelsAtom), get(defaultModelsAtom).inference?.provider_id ?? ""),
);

export {
  canvasGenerationFailuresAtom,
  canvasGenerationRuntimeStatesAtom,
  canvasGraphAtom,
  canvasGraphLoadedAtom,
  canvasNodesAtom,
  storyboardShotsAtom,
} from "./canvasGraph";
export { useStudioMutationCoordinator } from "./mutations";
