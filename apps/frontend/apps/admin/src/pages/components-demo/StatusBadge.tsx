import { Badge } from "components";

const variantMap: Record<string, "default" | "secondary" | "outline"> = {
  published: "default",
  draft: "secondary",
  archived: "outline",
};

const labelMap: Record<string, string> = {
  published: "已发布",
  draft: "草稿",
  archived: "已归档",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={variantMap[status] ?? "outline"}>
      {labelMap[status] ?? status}
    </Badge>
  );
}
