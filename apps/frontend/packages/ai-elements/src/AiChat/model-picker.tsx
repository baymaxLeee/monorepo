import { Button } from "@repo/design-system/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@repo/design-system/shadcn/dropdown-menu";
import { ChevronDownIcon } from "lucide-react";

export interface ModelPickerOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}
export interface ModelPickerProps {
  value: string;
  options: ModelPickerOption[];
  onValueChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
}
export function ModelPicker({ value, options, onValueChange, label = "选择模型", disabled }: ModelPickerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={label} />}
      >
        {options.find((option) => option.value === value)?.label ?? label}
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value} disabled={option.disabled} closeOnClick>
                <span className="flex flex-col">
                  <span>{option.label}</span>
                  {option.description ? (
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  ) : null}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
