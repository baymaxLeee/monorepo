import { Check as IconCheck } from "lucide-react";

import { ActionButton } from "@/components/ActionButton";
import { GenerationConfiguration, type GenerationModelOption } from "@/components/GenerationConfiguration/index";
import type { canvasnode } from "@/domain";
import t from "@/utils/i18n";

import type { StoryboardSettings } from "../domain/types";

export function StoryboardToolbar({
  dirty,
  matching = false,
  editable,
  editing,
  generateDisabled = false,
  generating,
  modelOptions,
  saving,
  settings,
  videoInputMode,
  onCancel,
  onChange,
  onEdit,
  onSettingsEdit,
  onGenerate,
  onVideoInputModeChange,
  onSave,
}: {
  dirty: boolean;
  matching?: boolean;
  editable: boolean;
  editing: boolean;
  generateDisabled?: boolean;
  generating: boolean;
  modelOptions: GenerationModelOption[];
  saving: boolean;
  settings: StoryboardSettings;
  videoInputMode: canvasnode.CanvasVideoInputMode;
  onCancel: () => void;
  onChange: (settings: StoryboardSettings) => void;
  onEdit: () => void;
  onSettingsEdit: () => void;
  onGenerate: () => void;
  onVideoInputModeChange: (mode: canvasnode.CanvasVideoInputMode) => void;
  onSave: () => void;
}) {
  return (
    <div className="flex h-8 min-w-0 flex-1 items-center justify-end gap-3">
      <div
        className="flex min-w-0"
        onFocusCapture={() => {
          if (!editing && editable) onSettingsEdit();
        }}
        onPointerDownCapture={() => {
          if (!editing && editable) onSettingsEdit();
        }}
      >
        <GenerationConfiguration
          disabled={matching || generating || !editable}
          fitContent
          generationMode={videoInputMode}
          generationModeDisabled={matching || saving || !editable}
          modelOptions={modelOptions}
          onGenerationModeChange={onVideoInputModeChange}
          onVideoSettingsChange={onChange}
          parameters="video"
          videoSettings={settings}
        />
      </div>

      {/* 编辑态给 取消 / 保存，读态给 编辑 / 生成视频，两组互斥。 */}
      {editing ? (
        <>
          <ActionButton disabled={saving} onClick={onCancel}>
            {t("取消")}
          </ActionButton>
          <ActionButton
            disabled={!dirty || matching}
            icon={<IconCheck />}
            loading={saving}
            onClick={onSave}
            variant="success"
          >
            {t("保存")}
          </ActionButton>
        </>
      ) : (
        <>
          <ActionButton disabled={!editable} onClick={onEdit}>
            {t("编辑")}
          </ActionButton>
          <ActionButton disabled={matching || !editable || generateDisabled} loading={generating} onClick={onGenerate}>
            {t("生成视频")}
          </ActionButton>
        </>
      )}
    </div>
  );
}
