import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/design-system";
import { ArrowDownWideNarrow as IconDescendingSorting } from "lucide-react";

import t from "@/utils/i18n";

import styles from "./SortControl.module.less";

export type SortOption = {
  label: string;
  value: string;
};

type SortControlProps = {
  ariaLabel?: string;
  ascending: boolean;
  onAscendingChange: (ascending: boolean) => void;
  onValueChange: (value: string) => void;
  options: SortOption[];
  value: string;
};

export function SortControl({
  ariaLabel = t("排序"),
  ascending,
  onAscendingChange,
  onValueChange,
  options,
  value,
}: SortControlProps) {
  return (
    <div aria-label={ariaLabel} className={styles.sortControl} role="group">
      {options.length === 1 ? (
        <span className={styles.sortLabel}>{options[0]?.label}</span>
      ) : (
        <Select onValueChange={(next) => next && onValueChange(next)} value={value}>
          <SelectTrigger aria-label={ariaLabel} className={`${styles.sortSelect} border-0 shadow-none`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button
        aria-label={t("切换排序方向")}
        className={styles.sortDirectionButton}
        onClick={() => onAscendingChange(!ascending)}
        size="default"
        variant="ghost"
      >
        <IconDescendingSorting className={ascending ? styles.ascendingIcon : undefined} />
      </Button>
    </div>
  );
}
