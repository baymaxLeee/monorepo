import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/design-system";
import { useAtomValue } from "jotai";

import { type GenerationModelOption } from "@/components/GenerationConfiguration/index";
import { canvasnode } from "@/domain";
import t from "@/utils/i18n";

import {
  defaultImageModelIdAtom,
  defaultTextModelIdAtom,
  defaultVideoModelIdAtom,
  imageModelsAtom,
  textModelsAtom,
  videoModelsAtom,
} from "../../store/index";
import { modelOptionsForType } from "../graph/canvasNodeHelpers";
import type { CanvasNodeData } from "../graph/canvasNodeTypes";
export function CanvasModelSelect({
  disabled,
  item,
  modelOptions,
  onPatch,
}: {
  disabled: boolean;
  item: canvasnode.CanvasNode;
  modelOptions: GenerationModelOption[];
  onPatch: CanvasNodeData["onPatch"];
}) {
  const defaultImageModelId = useAtomValue(defaultImageModelIdAtom);
  const defaultTextModelId = useAtomValue(defaultTextModelIdAtom);
  const defaultVideoModelId = useAtomValue(defaultVideoModelIdAtom);
  const defaultModelId =
    item.Type === canvasnode.CanvasNodeType.IMAGE_GENERATION
      ? defaultImageModelId
      : item.Type === canvasnode.CanvasNodeType.TEXT_GENERATION
        ? defaultTextModelId
        : defaultVideoModelId;
  const persistedModelId = item.GenerationConfig?.ModelServiceID;
  const selectedModelId = modelOptions.some((model) => model.id === persistedModelId)
    ? persistedModelId
    : defaultModelId;
  return (
    <Select
      disabled={disabled || modelOptions.length === 0}
      onValueChange={(ModelServiceID) => ModelServiceID && onPatch(item, { GenerationConfig: { ModelServiceID } })}
      value={selectedModelId || undefined}
    >
      <SelectTrigger aria-label={t("生成模型")} className="w-[150px] border-0 bg-muted text-[11px] shadow-none">
        <SelectValue placeholder={t("选择模型")} />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false} className="canvas-editor-overlay w-max">
        {modelOptions.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            <span className="block truncate" title={model.name}>
              {model.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function useCanvasModelOptions(type: canvasnode.CanvasNodeType) {
  const image = useAtomValue(imageModelsAtom);
  return {
    image,
    selected: modelOptionsForType(type, image, useAtomValue(textModelsAtom), useAtomValue(videoModelsAtom)),
  };
}
