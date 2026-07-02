import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";
import { cn } from "shared";
import { Badge } from "../shadcn/badge";
import { Button } from "../shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shadcn/dropdown-menu";

export type ModelSelectorOption = {
  id: string;
  label: string;
  description?: string;
  badge?: string;
};

export type ModelSelectorProps = {
  value?: string | null;
  options: ModelSelectorOption[];
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function ModelSelector({
  value,
  options,
  onValueChange,
  placeholder = "Select model",
  disabled,
  className,
}: ModelSelectorProps) {
  const selected = options.find((option) => option.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn(
            "h-8 max-w-72 justify-between gap-2 text-muted-foreground hover:text-foreground",
            className,
          )}
          disabled={disabled}
          type="button"
          variant="ghost"
        >
          <span className="min-w-0 truncate">
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onClick={() => onValueChange?.(option.id)}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{option.label}</span>
              {option.description ? (
                <span className="truncate text-xs text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </div>
            {option.badge ? (
              <Badge variant="outline" className="h-5 text-[10px]">
                {option.badge}
              </Badge>
            ) : null}
            {option.id === value ? <CheckIcon className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type ModelSelectorGroupProps = HTMLAttributes<HTMLDivElement>;

export function ModelSelectorGroup({
  className,
  ...props
}: ModelSelectorGroupProps) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}

export type ModelSelectorLabelProps = ComponentProps<"span">;

export function ModelSelectorLabel({
  className,
  ...props
}: ModelSelectorLabelProps) {
  return (
    <span
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}
