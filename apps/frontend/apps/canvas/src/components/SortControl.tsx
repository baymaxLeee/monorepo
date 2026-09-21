import { ArrowDownWideNarrow as IconDescendingSorting } from "lucide-react";

import { Select, Button } from "@/components/ui";
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
        <Select bordered={false} className={styles.sortSelect} onChange={onValueChange} size="default" value={value}>
          {options.map((option) => (
            <Select.Option key={option.value} value={option.value}>
              {option.label}
            </Select.Option>
          ))}
        </Select>
      )}
      <Button
        aria-label={t("切换排序方向")}
        className={styles.sortDirectionButton}
        icon={<IconDescendingSorting className={ascending ? styles.ascendingIcon : undefined} />}
        onClick={() => onAscendingChange(!ascending)}
        size="default"
        type="text"
      />
    </div>
  );
}
