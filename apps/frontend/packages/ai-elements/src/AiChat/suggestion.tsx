import { Button } from "@repo/design-system/shadcn/button";
import { cn } from "@repo/shared";
import { SparklesIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";

export type SuggestionsProps = HTMLAttributes<HTMLDivElement>;

export function Suggestions({ className, ...props }: SuggestionsProps) {
  return <div className={cn("flex flex-wrap gap-2", className)} {...props} />;
}

export type SuggestionProps = ComponentProps<typeof Button> & {
  suggestion?: string;
};

export function Suggestion({
  className,
  suggestion,
  children,
  variant = "outline",
  size = "sm",
  ...props
}: SuggestionProps) {
  return (
    <Button
      className={cn("h-8 max-w-full justify-start gap-1.5 rounded-full", className)}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      <SparklesIcon className="size-3.5 shrink-0" />
      <span className="truncate">{children ?? suggestion}</span>
    </Button>
  );
}
