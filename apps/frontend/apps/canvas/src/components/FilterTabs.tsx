import type { KeyboardEvent, ReactNode } from "react";

import styles from "./FilterTabs.module.less";

type FilterTabValue = string | number | boolean;

export interface FilterTabOption<Value extends FilterTabValue> {
  label: ReactNode;
  value: Value;
}

export function FilterTabs<Value extends FilterTabValue>({
  ariaLabel,
  disabled = false,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (nextValue: Value) => void;
  options: FilterTabOption<Value>[];
  value: Value;
}) {
  return (
    <div aria-label={ariaLabel} className={styles.track} role="group">
      {options.map((option) => {
        const active = option.value === value;
        const selectOption = () => {
          if (!disabled) onChange(option.value);
        };
        const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
          if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          onChange(option.value);
        };
        return (
          <div
            aria-disabled={disabled}
            aria-pressed={active}
            className={`${styles.item} ${active ? styles.itemActive : ""}`}
            key={String(option.value)}
            onClick={selectOption}
            onKeyDown={handleKeyDown}
            role="button"
            tabIndex={disabled ? -1 : 0}
          >
            {option.label}
          </div>
        );
      })}
    </div>
  );
}
