import { Plus as IconPlus } from "lucide-react";

import emptyIllustration from "@/assets/storyboard-empty.png";
import { ActionButton } from "@/components/ActionButton";
import t from "@/utils/i18n";

export function EmptyStoryboard({
  batchDisabled = false,
  createDisabled = false,
  onCreate,
  onCreateBatch,
}: {
  batchDisabled?: boolean;
  createDisabled?: boolean;
  onCreate: () => void;
  onCreateBatch: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
      <img alt="" className="h-[280px] w-[300px] object-contain" src={emptyIllustration} />
      <div className="flex items-center gap-3">
        <ActionButton disabled={batchDisabled} onClick={onCreateBatch} size={36}>
          {t("批量创建分镜")}
        </ActionButton>
        <ActionButton disabled={createDisabled} icon={<IconPlus />} onClick={onCreate} size={36} variant="primary">
          {t("创建分镜")}
        </ActionButton>
      </div>
    </div>
  );
}
