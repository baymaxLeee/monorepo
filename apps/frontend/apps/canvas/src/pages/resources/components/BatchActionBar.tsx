import { X as IconClose, ShieldCheck as IconComplianceLine, Trash2 as IconDeleteLine } from "lucide-react";

import { Tooltip, Checkbox, Button } from "@/components/ui";
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
    <div
      style={{
        alignItems: "center",
        backdropFilter: "blur(2px)",
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        borderRadius: 16,
        bottom: 16,
        display: "flex",
        gap: 80,
        left: "50%",
        padding: "10px 16px",
        position: "absolute",
        transform: "translateX(-50%)",
        zIndex: 50,
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: 8,
          height: 28,
          padding: "0 4px",
        }}
      >
        <Tooltip content={allSelected ? t("取消选择当页全部") : t("选中当页全部")} position="top">
          <span className="inline-flex items-center">
            <Checkbox
              checked={allSelected}
              className={`p-0 leading-none ${styles.pageSelectorCheckbox}`}
              disabled={busy || pageItemCount === 0}
              indeterminate={partiallySelected}
              onChange={() => onSelectPage(!allSelected)}
            />
          </span>
        </Tooltip>
        <span
          style={{
            color: "#fff",
            fontSize: 13,
            lineHeight: "22px",
            whiteSpace: "nowrap",
          }}
        >
          {t("已选 {count} 项", { count: selectedCount })}
        </span>
      </div>
      <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
        <Button
          disabled={reviewButtonDisabled}
          onClick={onReview}
          size="mini"
          style={{
            alignItems: "center",
            backgroundColor: "#fff",
            border: 0,
            borderRadius: 8,
            color: reviewButtonDisabled ? "var(--muted-foreground)" : "var(--foreground)",
            display: "inline-flex",
            fontSize: 13,
            fontWeight: 500,
            height: 28,
            justifyContent: "center",
            padding: "0 12px",
          }}
        >
          <span className="inline-flex items-center gap-1">
            <IconComplianceLine className="h-4 w-4 flex-none" />
            <span>{t("合规审核")}</span>
          </span>
        </Button>
        <Button
          disabled={deleteButtonDisabled}
          onClick={onDelete}
          size="mini"
          style={{
            alignItems: "center",
            backgroundColor: "#fff",
            border: 0,
            borderRadius: 8,
            color: deleteButtonDisabled ? "var(--muted-foreground)" : "var(--foreground)",
            display: "inline-flex",
            fontSize: 13,
            fontWeight: 500,
            height: 28,
            justifyContent: "center",
            padding: "0 12px",
          }}
        >
          <span className="inline-flex items-center gap-1">
            <IconDeleteLine className="h-4 w-4 flex-none" />
            <span>{t("删除")}</span>
          </span>
        </Button>
        <button
          aria-label={t("退出批量操作")}
          className="flex cursor-pointer items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          onClick={onClose}
          style={{
            background: "transparent",
            border: 0,
            color: "#fff",
            fontSize: 20,
            height: 20,
            padding: 0,
            width: 20,
          }}
          type="button"
        >
          <IconClose />
        </button>
      </div>
    </div>
  );
}
