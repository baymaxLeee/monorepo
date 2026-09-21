import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";

import { ActionButton } from "@/components/ActionButton";
import {
  DEFAULT_GENERATION_SETTINGS,
  GenerationConfiguration,
  type GenerationSettings,
} from "@/components/GenerationConfiguration/index";
import {
  getVideoModelParamConfigByOption,
  sanitizeGenerationSettings,
} from "@/components/GenerationConfiguration/videoModelConfig";
import { Input, Modal, Select, InputNumber } from "@/components/ui";
import { HIDDEN_SCROLLBAR_CLASS, HIDDEN_SCROLLBAR_STYLE } from "@/hooks/useHorizontalScrollFade";
import t from "@/utils/i18n";

import {
  DEFAULT_SHOT_DURATION_RANGE,
  DEFAULT_VIDEO_DURATION_RANGE,
  type ScriptDurationRange,
  storyboardShotDurationLimits,
} from "./scriptDuration";
import { splitScriptInstruction } from "./scriptInstruction";

import styles from "./ScriptDesignDialog.module.less";
import modalSizing from "@/components/ModalSizing.module.less";

const { formatReference: SCRIPT_FORMAT_REFERENCE, instruction: SCRIPT_INSTRUCTION } = splitScriptInstruction(
  t("输入本集的剧本，将根据内容自动拆解分镜。剧本格式参考："),
);

// starling-disable-next-line
const SCRIPT_PLACEHOLDER = `${SCRIPT_FORMAT_REFERENCE}
1-1、地下室/门外，日，内/外
△地下室的门"砰"的一声被破开，同时两名群演手下被踢翻在地。怒气冲冲的霍一天闯进地下室。霍一天(目露凶光)：这些年我为组织出生入死，为什么要这么对我?
【字幕："创"字会骨干成员，霍一天】
△一名身穿黑色连帽衫的人背着身，其面对的墙上有一个大红色的"创"字。("创"字外面是一个黑色的圆圈)
△镜头移向黑色连帽衫人的旁边，一个身穿白色连帽衫且戴着白色面具的人。白色面具人(变声器)：大胆霍一天，未经通传，竟敢私闯主公禁地?
【字幕:"创"字会右护法】
△说着，白色面具人手一扬，霍一天立刻飞向半空，撞到墙上随即落地。
△小武上前搀扶着霍一天。`;

const PARAM_SUMMARY_KEYS = ["ratio", "resolution", "audio", "watermark"] as const;

export interface ScriptDesignModelOption {
  assetLimits?: Partial<{ audio: number; image: number; video: number }>;
  audios?: readonly string[];
  id: string;
  name: string;
  durationMinSeconds?: number;
  durationMaxSeconds?: number;
  ratios?: readonly string[];
  resolutions?: readonly string[];
  watermarks?: readonly string[];
}

const VIDEO_DURATION_LIMIT_MIN_MINUTES = 1;
const VIDEO_DURATION_LIMIT_MAX_MINUTES = 50;
const MODAL_CHILD_POPUP_Z_INDEX = 1002;
const STORYBOARD_RECOMMENDED_PLOT_CHARACTERS = 6000;
const STORYBOARD_HARD_PLOT_CHARACTERS = 30000;

function clampDurationRange(min: number, max: number, limitMin: number, limitMax: number): ScriptDurationRange {
  const nextMin = Math.min(limitMax, Math.max(limitMin, min));
  const nextMax = Math.min(limitMax, Math.max(nextMin, max));
  return { min: nextMin, max: nextMax };
}

function filterModelOption(input: string, option: ReactElement) {
  const keyword = input.trim().toLowerCase();
  if (!keyword) {
    return true;
  }
  const props = option.props as { children?: unknown; value?: unknown };
  const label = String(props.children ?? "");
  const id = String(props.value ?? "");
  return label.toLowerCase().includes(keyword) || id.toLowerCase().includes(keyword);
}

function LabeledField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[14px] font-medium leading-6 tracking-[0.042px] text-[color:var(--color-text-1)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function ModelSelectChip({
  options,
  value,
  onChange,
}: {
  options: ScriptDesignModelOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className={styles.modelSelectChip}>
      <Select
        bordered={false}
        className={styles.modelSelect}
        disabled={options.length === 0}
        filterOption={filterModelOption}
        onChange={onChange}
        placeholder={t("选择模型")}
        showSearch
        value={value || undefined}
      >
        {options.map((model) => (
          <Select.Option key={model.id} value={model.id}>
            {model.name}
          </Select.Option>
        ))}
      </Select>
    </div>
  );
}

function DurationNumberField({
  ariaLabel,
  limitMax,
  limitMin,
  name,
  value,
  onChange,
}: {
  ariaLabel: string;
  limitMax: number;
  limitMin: number;
  name: string;
  value: number;
  onChange: (value: number | undefined) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  return (
    <div
      className={styles.durationField}
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest("input")) {
          return;
        }
        event.preventDefault();
        wrapRef.current?.querySelector("input")?.focus();
      }}
      ref={wrapRef}
    >
      <InputNumber
        aria-label={ariaLabel}
        autoComplete="duration-seconds"
        autoCorrect="off"
        data-1p-ignore
        data-form-type="other"
        data-lpignore="true"
        hideControl
        max={limitMax}
        min={limitMin}
        name={name}
        onChange={onChange}
        precision={0}
        spellCheck={false}
        value={value}
      />
    </div>
  );
}

function DurationRangeInput({
  limitMax,
  limitMin,
  max,
  min,
  namePrefix,
  unit,
  onChange,
}: {
  limitMax: number;
  limitMin: number;
  max: number;
  min: number;
  namePrefix: string;
  unit: string;
  onChange: (range: ScriptDurationRange) => void;
}) {
  return (
    <form autoComplete="off" className={styles.durationRange} onSubmit={(event) => event.preventDefault()}>
      <div className={styles.durationValues}>
        <DurationNumberField
          ariaLabel={`${t("{namePrefix} 下限", { namePrefix })}`}
          limitMax={limitMax}
          limitMin={limitMin}
          name={`${namePrefix}-min`}
          onChange={(value) => onChange(clampDurationRange(value ?? limitMin, max, limitMin, limitMax))}
          value={min}
        />
        <span className={styles.durationSep}>~</span>
        <DurationNumberField
          ariaLabel={`${t("{namePrefix} 上限", { namePrefix })}`}
          limitMax={limitMax}
          limitMin={limitMin}
          name={`${namePrefix}-max`}
          onChange={(value) => onChange(clampDurationRange(min, value ?? limitMax, limitMin, limitMax))}
          value={max}
        />
      </div>
      <span className={styles.durationUnit}>{unit}</span>
    </form>
  );
}

export function ScriptDesignDialog({
  initialPlot = "",
  initialSettings = DEFAULT_GENERATION_SETTINGS,
  initialStoryboardModel = "",
  initialShotDuration,
  initialVideoDuration = DEFAULT_VIDEO_DURATION_RANGE,
  modelOptions,
  storyboardModelOptions,
  visible,
  onCancel,
  onSubmit,
}: {
  initialPlot?: string;
  initialSettings?: GenerationSettings;
  initialStoryboardModel?: string;
  initialShotDuration?: ScriptDurationRange;
  initialVideoDuration?: ScriptDurationRange;
  modelOptions: ScriptDesignModelOption[];
  storyboardModelOptions: ScriptDesignModelOption[];
  visible: boolean;
  onCancel: () => void;
  onSubmit: (
    plot: string,
    settings: GenerationSettings,
    durations: { shot: ScriptDurationRange; video: ScriptDurationRange },
    storyboardModel: string,
  ) => void;
}) {
  const [plot, setPlot] = useState(initialPlot);
  const [storyboardModel, setStoryboardModel] = useState(initialStoryboardModel || storyboardModelOptions[0]?.id || "");
  const [settings, setSettings] = useState(() =>
    sanitizeGenerationSettings(initialSettings, getVideoModelParamConfigByOption(initialSettings.model, modelOptions)),
  );
  const [shotDuration, setShotDuration] = useState<ScriptDurationRange>(
    () => initialShotDuration ?? DEFAULT_SHOT_DURATION_RANGE,
  );
  const [videoDuration, setVideoDuration] = useState<ScriptDurationRange>(initialVideoDuration);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setPlot(initialPlot);
    setStoryboardModel((current) =>
      storyboardModelOptions.some((item) => item.id === initialStoryboardModel)
        ? initialStoryboardModel
        : storyboardModelOptions.some((item) => item.id === current)
          ? current
          : (storyboardModelOptions[0]?.id ?? ""),
    );
    const model = initialSettings.model || modelOptions[0]?.id || initialSettings.model;
    const config = getVideoModelParamConfigByOption(model, modelOptions);
    const shotDurationLimits = storyboardShotDurationLimits(config.limits);
    setSettings(sanitizeGenerationSettings({ ...initialSettings, model }, config));
    setShotDuration(
      clampDurationRange(
        initialShotDuration?.min ?? DEFAULT_SHOT_DURATION_RANGE.min,
        initialShotDuration?.max ?? DEFAULT_SHOT_DURATION_RANGE.max,
        shotDurationLimits.min,
        shotDurationLimits.max,
      ),
    );
    setVideoDuration(
      clampDurationRange(
        initialVideoDuration.min,
        initialVideoDuration.max,
        VIDEO_DURATION_LIMIT_MIN_MINUTES,
        VIDEO_DURATION_LIMIT_MAX_MINUTES,
      ),
    );
    // 仅在打开弹窗或回填剧本时重置，避免模型列表异步返回时清掉正在输入的剧本。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPlot, visible]);

  useEffect(() => {
    if (!visible || modelOptions.length === 0) {
      return;
    }
    setSettings((current) => {
      const model = modelOptions.some((item) => item.id === current.model) ? current.model : modelOptions[0].id;
      const config = getVideoModelParamConfigByOption(model, modelOptions);
      const shotDurationLimits = storyboardShotDurationLimits(config.limits);
      setShotDuration((duration) =>
        clampDurationRange(duration.min, duration.max, shotDurationLimits.min, shotDurationLimits.max),
      );
      setVideoDuration((duration) =>
        clampDurationRange(
          duration.min,
          duration.max,
          VIDEO_DURATION_LIMIT_MIN_MINUTES,
          VIDEO_DURATION_LIMIT_MAX_MINUTES,
        ),
      );
      return sanitizeGenerationSettings({ ...current, model }, config);
    });
  }, [visible, modelOptions]);

  useEffect(() => {
    if (!visible || storyboardModelOptions.length === 0) {
      return;
    }
    setStoryboardModel((current) =>
      storyboardModelOptions.some((item) => item.id === current) ? current : storyboardModelOptions[0].id,
    );
  }, [visible, storyboardModelOptions]);

  const modelParamConfig = getVideoModelParamConfigByOption(settings.model, modelOptions);
  const shotDurationLimits = storyboardShotDurationLimits(modelParamConfig.limits);
  const shotDurationLimitMinSeconds = shotDurationLimits.min;
  const shotDurationLimitMaxSeconds = shotDurationLimits.max;

  const emitSettings = (next: GenerationSettings) => {
    const config = getVideoModelParamConfigByOption(next.model, modelOptions);
    const shotDurationLimits = storyboardShotDurationLimits(config.limits);
    setSettings(sanitizeGenerationSettings(next, config));
    setShotDuration((duration) =>
      clampDurationRange(duration.min, duration.max, shotDurationLimits.min, shotDurationLimits.max),
    );
    setVideoDuration((duration) =>
      clampDurationRange(
        duration.min,
        duration.max,
        VIDEO_DURATION_LIMIT_MIN_MINUTES,
        VIDEO_DURATION_LIMIT_MAX_MINUTES,
      ),
    );
  };

  return (
    <Modal
      footer={null}
      maskClosable
      onCancel={onCancel}
      className={modalSizing.storyboard}
      title={
        <span className="text-[18px] font-medium leading-6.5 tracking-[0.054px] text-[#1a2233]">{t("剧本设计")}</span>
      }
      visible={visible}
    >
      <div className={`${modalSizing.storyboardBody} flex min-h-0 overflow-hidden gap-6`}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <p className="m-0 shrink-0 text-[13px] leading-5.5 tracking-[0.039px] text-[color:var(--color-text-2)]">
            {SCRIPT_INSTRUCTION}
          </p>
          <div className={`min-h-0 flex-1 ${styles.plotInput}`}>
            <Input.TextArea
              className={HIDDEN_SCROLLBAR_CLASS}
              maxLength={STORYBOARD_HARD_PLOT_CHARACTERS}
              onChange={setPlot}
              placeholder={SCRIPT_PLACEHOLDER}
              style={{
                resize: "none",
                height: "100%",
                overflowY: "auto",
                ...HIDDEN_SCROLLBAR_STYLE,
              }}
              wrapperStyle={{ display: "block", height: "100%" }}
              value={plot}
            />
          </div>
        </div>

        <div className="w-[1px] shrink-0 self-stretch bg-[color:var(--color-border-3)]" />

        <div className="flex h-full w-[260px] shrink-0 flex-col gap-6 overflow-y-auto">
          <LabeledField label={t("分镜模型")}>
            <ModelSelectChip onChange={setStoryboardModel} options={storyboardModelOptions} value={storyboardModel} />
          </LabeledField>
          <LabeledField label={t("视频模型")}>
            <ModelSelectChip
              onChange={(model) => emitSettings({ ...settings, model })}
              options={modelOptions}
              value={settings.model}
            />
          </LabeledField>
          <LabeledField label={t("分镜时长（参考范围）")}>
            <DurationRangeInput
              limitMax={shotDurationLimitMaxSeconds}
              limitMin={shotDurationLimitMinSeconds}
              max={shotDuration.max}
              min={shotDuration.min}
              namePrefix="shot-duration-seconds"
              onChange={setShotDuration}
              unit={t("秒")}
            />
          </LabeledField>
          <LabeledField label={t("视频时长（参考范围）")}>
            <DurationRangeInput
              limitMax={VIDEO_DURATION_LIMIT_MAX_MINUTES}
              limitMin={VIDEO_DURATION_LIMIT_MIN_MINUTES}
              max={videoDuration.max}
              min={videoDuration.min}
              namePrefix="video-duration-minutes"
              onChange={setVideoDuration}
              unit={t("分钟")}
            />
          </LabeledField>
          <p className="m-0 text-[12px] leading-5 text-[color:var(--color-text-3)]">
            {t("时长仅用于引导节奏，生成会优先保证剧情完整和自然，不会刻意逼近上下限。")}
          </p>
          <LabeledField label={t("视频参数")}>
            <GenerationConfiguration
              fillParameterWidth
              modelOptions={modelOptions}
              onVideoSettingsChange={emitSettings}
              parameters="video"
              popupZIndex={MODAL_CHILD_POPUP_Z_INDEX}
              showDuration={false}
              showModel={false}
              summaryKeys={[...PARAM_SUMMARY_KEYS]}
              videoSettings={settings}
            />
          </LabeledField>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <p
          className={`m-0 shrink-0 text-[12px] leading-5 ${
            plot.length > STORYBOARD_RECOMMENDED_PLOT_CHARACTERS
              ? "text-[color:rgb(var(--warning-7))]"
              : "text-[color:var(--color-text-3)]"
          }`}
        >
          {t("建议单次不超过 6000 字；当前 {count}/30000 字", {
            count: plot.length,
          })}
        </p>
        <div className="flex items-center justify-end gap-3">
          <ActionButton onClick={onCancel}>{t("取消")}</ActionButton>
          <ActionButton
            disabled={!plot.trim() || !settings.model || !storyboardModel}
            onClick={() =>
              onSubmit(
                plot.trim(),
                { ...settings, duration: `${shotDuration.min}s` },
                { shot: shotDuration, video: videoDuration },
                storyboardModel,
              )
            }
            variant="primary"
          >
            {t("确定")}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}
