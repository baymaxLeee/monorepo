import { Card, CardContent, CardHeader, Muted, Skeleton } from "@packages/components";

/** Placeholder while session is checked on /login (avoids full-screen flash). */
export function AuthLoadingCard() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Muted className="text-center text-xs">正在检查登录状态…</Muted>
        </CardContent>
      </Card>
    </div>
  );
}
