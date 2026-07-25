import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "components";
import { isRouteErrorResponse, Navigate, useRouteError } from "react-router-dom";

export function RouteErrorFallback() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <Navigate to="/404" replace />;
  }

  const message = error instanceof Error ? error.message : "路由模块加载失败，请稍后重试。";

  return (
    <Card className="m-6 max-w-lg">
      <CardHeader>
        <CardTitle>页面加载失败</CardTitle>
        <CardDescription>无法加载当前应用的路由模块，请确认远端服务可用。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button type="button" variant="outline" onClick={() => globalThis.location.reload()}>
          重试
        </Button>
      </CardContent>
    </Card>
  );
}
