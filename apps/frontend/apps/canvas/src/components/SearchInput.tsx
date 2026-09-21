import { Search as IconSearch } from "lucide-react";
import type { ComponentProps } from "react";

import { Input } from "@/components/ui";

import styles from "./SearchInput.module.less";

type SearchInputProps = Omit<ComponentProps<typeof Input>, "prefix" | "size">;

export function SearchInput({ className, ...props }: SearchInputProps) {
  return (
    <Input
      {...props}
      allowClear
      className={[styles.searchInput, className].filter(Boolean).join(" ")}
      prefix={<IconSearch />}
      size="default"
    />
  );
}
