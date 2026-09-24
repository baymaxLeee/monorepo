import { FieldSet, FieldLegend, ToggleGroup, ToggleGroupItem } from "@repo/design-system";

import t from "@/utils/i18n";

import { RatioIcon } from "./RatioIcon";

export interface ImageGenerationSettings {
  model: string;
  ratio: string;
  resolution: string;
  watermark: boolean;
}

export const DEFAULT_IMAGE_GENERATION_SETTINGS: ImageGenerationSettings = {
  model: "",
  ratio: "16:9",
  resolution: "720P",
  watermark: false,
};

export function ImageParametersPanel({
  settings,
  ratioOptions,
  resolutionOptions,
  disabledRatioOptions = [],
  disabledResolutionOptions = [],
  showWatermark,
  onChange,
}: {
  settings: ImageGenerationSettings;
  ratioOptions: readonly string[];
  resolutionOptions: readonly string[];
  disabledRatioOptions?: readonly string[];
  disabledResolutionOptions?: readonly string[];
  showWatermark: boolean;
  onChange: (settings: ImageGenerationSettings) => void;
}) {
  const disabledRatios = new Set(disabledRatioOptions);
  const disabledResolutions = new Set(disabledResolutionOptions);
  const patch = (part: Partial<ImageGenerationSettings>) => onChange({ ...settings, ...part });

  return (
    <div className="flex w-[353px] flex-col gap-4 rounded-xl bg-popover p-3 text-popover-foreground">
      <FieldSet className="gap-1">
        <FieldLegend className="text-xs text-muted-foreground" variant="label">
          {t("比例")}
        </FieldLegend>
        <ToggleGroup
          className="w-full items-stretch rounded-lg bg-muted p-1"
          onValueChange={(next) => next[0] && patch({ ratio: next[0] })}
          spacing={0}
          value={[settings.ratio]}
        >
          {ratioOptions.map((ratio) => {
            const disabled = disabledRatios.has(ratio);
            return (
              <ToggleGroupItem
                className="h-[58px] flex-1 flex-col rounded-md aria-pressed:bg-background aria-pressed:shadow-sm"
                data-ea="resource-image-settings-ratio-option"
                disabled={disabled}
                key={ratio}
                value={ratio}
              >
                <RatioIcon ratio={ratio} selected={ratio === settings.ratio} />
                {ratio}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </FieldSet>

      <FieldSet className="gap-1">
        <FieldLegend className="text-xs text-muted-foreground" variant="label">
          {t("分辨率")}
        </FieldLegend>
        <ToggleGroup
          className="w-full items-stretch rounded-lg bg-muted p-1"
          onValueChange={(next) => next[0] && patch({ resolution: next[0] })}
          spacing={0}
          value={[settings.resolution]}
        >
          {resolutionOptions.map((resolution) => {
            const disabled = disabledResolutions.has(resolution);
            return (
              <ToggleGroupItem
                className="h-6 flex-1 rounded-md aria-pressed:bg-background aria-pressed:shadow-sm"
                data-ea="resource-image-settings-resolution-option"
                disabled={disabled}
                key={resolution}
                value={resolution}
              >
                {resolution}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </FieldSet>

      {showWatermark ? (
        <FieldSet className="gap-1">
          <FieldLegend className="text-xs text-muted-foreground" variant="label">
            {t("水印")}
          </FieldLegend>
          <ToggleGroup
            className="w-full items-stretch rounded-lg bg-muted p-1"
            onValueChange={(next) => next[0] && patch({ watermark: next[0] === "true" })}
            spacing={0}
            value={[String(settings.watermark)]}
          >
            {[
              { label: t("无水印"), value: false },
              { label: t("有水印"), value: true },
            ].map((option) => (
              <ToggleGroupItem
                className="h-6 flex-1 rounded-md aria-pressed:bg-background aria-pressed:shadow-sm"
                data-ea="resource-image-settings-watermark-option"
                key={String(option.value)}
                value={String(option.value)}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldSet>
      ) : null}
    </div>
  );
}
