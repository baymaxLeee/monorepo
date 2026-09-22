import { Minimize2 as IconAbbreviation } from "lucide-react";
import { useState } from "react";

import { GenerationEditorDialog } from "@/components/ImageGeneration/GenerationEditorDialog";
import type { AssetMentionItem, AssetMentionSource } from "@/components/promptEditor/index";
import t from "@/utils/i18n";

import { ScriptEditor } from "../../components/ScriptEditor";

import styles from "./CanvasTextEditor.module.less";

const EDITOR_MODAL_Z_INDEX = 100;

export interface CanvasTextEditorProps {
  expanded: boolean;
  initialValue: string;
  onChange: (value: string) => void;
  onCollapse: () => void;
  placeholder: string;
  queryTree: NonNullable<AssetMentionSource["queryTree"]>;
  reviewAsset?: AssetMentionSource["review"];
  selectAsset: (asset: AssetMentionItem) => Promise<AssetMentionItem>;
  title: string;
}

export function CanvasTextEditor({
  expanded,
  initialValue,
  onChange,
  onCollapse,
  placeholder,
  queryTree,
  reviewAsset,
  selectAsset,
  title,
}: CanvasTextEditorProps) {
  const [value, setValue] = useState(initialValue);

  const changeValue = (nextValue: string) => {
    setValue(nextValue);
    onChange(nextValue);
  };

  const renderEditor = () => (
    <div className={`${styles.editor} flex min-h-0 flex-1`}>
      <ScriptEditor
        editable
        onChange={changeValue}
        placeholder={placeholder}
        queryTree={queryTree}
        reviewAsset={reviewAsset}
        script={value}
        selectAsset={selectAsset}
      />
    </div>
  );

  return (
    <>
      {renderEditor()}
      <GenerationEditorDialog onClose={onCollapse} visible={expanded} zIndex={EDITOR_MODAL_Z_INDEX}>
        <section
          className="nodrag nopan nowheel flex h-full w-full flex-col gap-5"
          onDoubleClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex h-6 flex-none items-center justify-between">
            <div className="min-w-0 truncate text-[14px] font-medium leading-6 text-foreground">{title}</div>
            <button
              aria-label={t("收起文本编辑器")}
              className={`${styles.collapseButton} flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-[8px] border-0 p-0 text-[16px]`}
              onClick={onCollapse}
              type="button"
            >
              <IconAbbreviation />
            </button>
          </div>
          <div className="flex min-h-0 flex-1">{renderEditor()}</div>
        </section>
      </GenerationEditorDialog>
    </>
  );
}
