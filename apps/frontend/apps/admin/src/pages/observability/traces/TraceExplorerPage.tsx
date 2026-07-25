import { Page, PageDescription, PageHeader, PageHeaderContent, PageTitle } from "components";

import { TraceExplorer } from "./TraceExplorer";

export function TraceExplorerPage() {
  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>Trace 查询</PageTitle>
          <PageDescription>查看最近后端 trace，并展开 gateway、chat、agent 与下游服务 timeline</PageDescription>
        </PageHeaderContent>
      </PageHeader>

      <TraceExplorer />
    </Page>
  );
}
