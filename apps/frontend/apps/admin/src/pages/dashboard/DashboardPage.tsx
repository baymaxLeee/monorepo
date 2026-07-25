import {
  fetchTelemetryErrors,
  fetchTelemetryPerformance,
  type TelemetryErrorEvent,
  type TelemetryPerformanceEvent,
} from "api";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
} from "components";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlatformStore } from "runtime";
import { getErrorMessage } from "shared";

import { DashboardContent } from "./DashboardContent";
import { buildDashboardData, buildVitalSummaries } from "./dashboardData";

export function DashboardPage() {
  const user = usePlatformStore((state) => state.user);
  const [items, setItems] = useState<TelemetryErrorEvent[]>([]);
  const [performanceItems, setPerformanceItems] = useState<TelemetryPerformanceEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchTelemetryErrors(200, { skipErrorNotify: true }),
      fetchTelemetryPerformance(500, { skipErrorNotify: true }),
    ])
      .then(([errors, performance]) => {
        setItems(errors.items);
        setPerformanceItems(performance.items);
      })
      .catch((err) => {
        setError(getErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const data = useMemo(() => buildDashboardData(items), [items]);
  const vitals = useMemo(() => buildVitalSummaries(performanceItems), [performanceItems]);

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>Dashboard</PageTitle>
          <PageDescription>{user ? `${user.displayName} 的可观测视图` : "可观测视图"}</PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading}>
            刷新
          </Button>
        </PageActions>
      </PageHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <DashboardContent data={data} items={items} loading={loading} vitals={vitals} />
    </Page>
  );
}
