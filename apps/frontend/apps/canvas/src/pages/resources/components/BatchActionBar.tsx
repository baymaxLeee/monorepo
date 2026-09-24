import { Button, Checkbox, Tooltip, TooltipContent, TooltipTrigger } from "@repo/design-system";
import { X as IconClose, ShieldCheck as IconComplianceLine, Trash2 as IconDeleteLine } from "lucide-react";

import t from "@/utils/i18n";

import styles from "./BatchActionBar.module.less";

export interface BatchActionBarProps {
  busy?: boolean;
  pageItemCount: number;
  reviewDisabled?: boolean;
  selectedCount: number;
  onClose: () => void;
  onDelete: () => void;
  onReview: () => void;
  onSelectPage: (selected: boolean) => void;
}

export function BatchActionBar({
  busy = false,
  pageItemCount,
  reviewDisabled = false,
  selectedCount,
  onClose,
  onDelete,
  onReview,
  onSelectPage,
}: BatchActionBarProps) {
  const allSelected = pageItemCount > 0 && selectedCount === pageItemCount;
  const partiallySelected = selectedCount > 0 && !allSelected;
  const hasSelection = selectedCount > 0;
  const reviewButtonDisabled = busy || !hasSelection || reviewDisabled;
  const deleteButtonDisabled = busy || !hasSelection;

  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-20 rounded-2xl bg-foreground/90 px-4 py-2.5 text-background shadow-lg backdrop-blur-sm">
      <div className="flex h-7 items-center gap-2 px-1">
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
            <span className="inline-flex items-center">
              <Checkbox
                aria-label={allSelected ? t("取消选择当页全部") : t("选中当页全部")}
                checked={allSelected}
                className={`p-0 leading-none ${styles.pageSelectorCheckbox}`}
                disabled={busy || pageItemCount === 0}
                indeterminate={partiallySelected}
                onCheckedChange={() => onSelectPage(!allSelected)}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{allSelected ? t("取消选择当页全部") : t("选中当页全部")}</TooltipContent>
        </Tooltip>
        <span className="whitespace-nowrap text-[13px] leading-5.5">
          {t("已选 {count} 项", { count: selectedCount })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          className="bg-background text-foreground hover:bg-muted"
          disabled={reviewButtonDisabled}
          onClick={onReview}
          size="sm"
          variant="secondary"
        >
          <IconComplianceLine data-icon="inline-start" />
          {t("合规审核")}
        </Button>
        <Button
          className="bg-background hover:bg-destructive/10"
          disabled={deleteButtonDisabled}
          onClick={onDelete}
          size="sm"
          variant="destructive"
        >
          <IconDeleteLine data-icon="inline-start" />
          {t("删除")}
        </Button>
        <Button
          aria-label={t("退出批量操作")}
          className="text-background hover:bg-background/15 hover:text-background"
          disabled={busy}
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <IconClose />
        </Button>
      </div>
    </div>
  );
}
