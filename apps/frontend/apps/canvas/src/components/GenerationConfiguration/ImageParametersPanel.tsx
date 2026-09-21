import { Field } from "@/components/Field";
import { SegmentedTrack, segmentItemClass } from "@/components/Segmented";
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

function optionClass(selected: boolean, disabled: boolean) {
  return `${segmentItemClass(selected)} ${
    disabled ? "cursor-not-allowed text-muted-foreground opacity-50 hover:text-muted-foreground" : ""
  }`;
}

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
    <div className="flex w-[353px] flex-col gap-4 rounded-[12px] border-[0.5px] border-solid border-border bg-white p-3 shadow-[0px_15px_35px_-2px_rgba(0,0,0,0.05),0px_5px_15px_0px_rgba(0,0,0,0.05)]">
      <Field label={t("比例")}>
        <SegmentedTrack>
          {ratioOptions.map((ratio) => {
            const disabled = disabledRatios.has(ratio);
            return (
              <button
                className={`${optionClass(ratio === settings.ratio, disabled)} h-[58px] flex-col`}
                data-ea="resource-image-settings-ratio-option"
                disabled={disabled}
                key={ratio}
                onClick={() => patch({ ratio })}
                type="button"
              >
                <RatioIcon ratio={ratio} selected={ratio === settings.ratio} />
                {ratio}
              </button>
            );
          })}
        </SegmentedTrack>
      </Field>

      <Field label={t("分辨率")}>
        <SegmentedTrack>
          {resolutionOptions.map((resolution) => {
            const disabled = disabledResolutions.has(resolution);
            return (
              <button
                className={`${optionClass(resolution === settings.resolution, disabled)} h-6`}
                data-ea="resource-image-settings-resolution-option"
                disabled={disabled}
                key={resolution}
                onClick={() => patch({ resolution })}
                type="button"
              >
                {resolution}
              </button>
            );
          })}
        </SegmentedTrack>
      </Field>

      {showWatermark ? (
        <Field label={t("水印")}>
          <SegmentedTrack>
            {[
              { label: t("无水印"), value: false },
              { label: t("有水印"), value: true },
            ].map((option) => (
              <button
                className={`${segmentItemClass(option.value === settings.watermark)} h-6`}
                data-ea="resource-image-settings-watermark-option"
                key={String(option.value)}
                onClick={() => patch({ watermark: option.value })}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </SegmentedTrack>
        </Field>
      ) : null}
    </div>
  );
}
