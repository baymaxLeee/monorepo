import { useAtomValue } from "jotai";

import { type GenerationModelOption } from "@/components/GenerationConfiguration/index";
import { Select } from "@/components/ui";
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
      bordered={false}
      className="w-[150px] rounded-[8px] bg-[rgba(26,27,30,0.05)] text-[11px]"
      disabled={disabled || modelOptions.length === 0}
      dropdownMenuClassName="canvas-editor-overlay"
      onChange={(ModelServiceID) => onPatch(item, { GenerationConfig: { ModelServiceID } })}
      placeholder={t("选择模型")}
      triggerProps={{
        autoAlignPopupMinWidth: true,
        autoAlignPopupWidth: false,
      }}
      value={selectedModelId || undefined}
    >
      {modelOptions.map((model) => (
        <Select.Option key={model.id} value={model.id}>
          <span className="block truncate" title={model.name}>
            {model.name}
          </span>
        </Select.Option>
      ))}
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
