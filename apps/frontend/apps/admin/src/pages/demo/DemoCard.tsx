import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "components";
import type { ReactNode } from "react";
import { cn } from "shared";

export interface DemoCardProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** 让卡片撑满父级剩余高度，并使 CardContent 内部成为 flex column。 */
  fill?: boolean;
  className?: string;
  contentClassName?: string;
}

export function DemoCard({
  title,
  description,
  children,
  fill = true,
  className,
  contentClassName,
}: DemoCardProps) {
  return (
    <Card
      className={cn(
        "overflow-hidden",
        fill && "flex min-h-0 flex-1 flex-col",
        className,
      )}
    >
      <CardHeader className="shrink-0 pb-3">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent
        className={cn(
          fill ? "flex min-h-0 flex-1 flex-col gap-3" : "grid gap-3",
          contentClassName,
        )}
      >
        {children}
      </CardContent>
    </Card>
  );
}
