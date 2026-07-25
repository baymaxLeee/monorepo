import type { TelemetryErrorEvent } from "api";
import { Badge, InlineCode, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "components";

import { formatTime, shortId } from "./dashboardData";

export function RecentErrors({ items }: { items: TelemetryErrorEvent[] }) {
  if (items.length === 0) {
    return <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">暂无错误数据</div>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>时间</TableHead>
          <TableHead>应用</TableHead>
          <TableHead>路由</TableHead>
          <TableHead>错误</TableHead>
          <TableHead>Session</TableHead>
          <TableHead>Trace</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.slice(0, 10).map((item) => (
          <TableRow key={`${item.fingerprint}-${item.ts_server}`}>
            <TableCell className="whitespace-nowrap">{formatTime(item.ts_server)}</TableCell>
            <TableCell>
              <Badge variant="outline">{item.app}</Badge>
            </TableCell>
            <TableCell className="max-w-52 truncate">{item.route}</TableCell>
            <TableCell>
              <div className="max-w-96">
                <div className="truncate font-medium">{item.message}</div>
                <div className="truncate text-xs text-muted-foreground">{item.name}</div>
              </div>
            </TableCell>
            <TableCell>
              <InlineCode>{shortId(item.session_id)}</InlineCode>
            </TableCell>
            <TableCell>
              <InlineCode>{shortId(item.trace_id)}</InlineCode>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
