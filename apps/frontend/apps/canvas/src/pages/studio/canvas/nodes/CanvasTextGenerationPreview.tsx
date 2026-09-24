import { Button } from "@repo/design-system";
import { Minimize2 as IconAbbreviation } from "lucide-react";

import { Markdown } from "@/components/common";
import { GenerationEditorDialog } from "@/components/ImageGeneration/GenerationEditorDialog";
import t from "@/utils/i18n";

import styles from "./CanvasTextGenerationPreview.module.less";

export function CanvasTextGenerationPreview({
  content,
  onClose,
  title,
  visible,
}: {
  content: string;
  onClose: () => void;
  title: string;
  visible: boolean;
}) {
  return (
    <GenerationEditorDialog onClose={onClose} visible={visible}>
      <section
        className="nodrag nopan nowheel flex h-full w-full flex-col gap-5"
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex h-6 flex-none items-center justify-between">
          <div className="min-w-0 truncate text-[14px] font-medium leading-6 text-foreground">{title}</div>
          <Button
            variant="ghost"
            aria-label={t("收起结果预览")}
            className={`${styles.collapseButton} flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-[8px] border-0 p-0 text-[16px]`}
            onClick={onClose}
            type="button"
          >
            <IconAbbreviation />
          </Button>
        </div>
        <div className={styles.content}>
          <Markdown className={styles.markdown} data={content} />
        </div>
      </section>
    </GenerationEditorDialog>
  );
}
