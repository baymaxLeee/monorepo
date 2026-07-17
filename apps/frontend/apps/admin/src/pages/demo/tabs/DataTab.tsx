import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "components";
import { DemoCard } from "../DemoCard";
import { StatusBadge } from "../StatusBadge";

const rows = [
  { name: "客服助手", status: "published", version: "v3" },
  { name: "销售 Bot", status: "draft", version: "v1" },
  { name: "归档示例", status: "archived", version: "v2" },
];

export function DataTab() {
  return (
    <DemoCard
      title="Table"
      description="静态示例数据"
      contentClassName="overflow-auto"
    >
      <div className="max-w-3xl">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">版本</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {row.version}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </DemoCard>
  );
}
