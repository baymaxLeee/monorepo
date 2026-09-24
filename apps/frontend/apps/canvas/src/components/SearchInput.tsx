import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@repo/design-system";
import { Search as IconSearch, X } from "lucide-react";
import type { ComponentProps } from "react";

import styles from "./SearchInput.module.less";

type SearchInputProps = Omit<ComponentProps<typeof InputGroupInput>, "onChange" | "type"> & {
  onChange?: (value: string) => void;
};

export function SearchInput({ className, ...props }: SearchInputProps) {
  return (
    <InputGroup className={[styles.searchInput, className].filter(Boolean).join(" ")}>
      <InputGroupAddon>
        <IconSearch aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        {...props}
        aria-label={props["aria-label"] ?? props.placeholder ?? "搜索"}
        onChange={(event) => props.onChange?.(event.currentTarget.value)}
        type="search"
      />
      {props.value ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="清空搜索" onClick={() => props.onChange?.("")} size="icon-xs">
            <X aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}
