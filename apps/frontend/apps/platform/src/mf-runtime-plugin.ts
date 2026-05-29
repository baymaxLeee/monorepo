/**
 * Module Federation runtime plugin (resource layer).
 *
 * Complements the React `ErrorBoundary` in `router/index.tsx` (render layer):
 * this hook fires when a remote's script/manifest fails to LOAD at all, before
 * any component renders. We report the failure to `observability` so remote
 * outages are visible in RUM, then rethrow so the existing boundary still shows
 * the "微前端加载失败 / 重试" UI.
 *
 * IMPORTANT: this module is evaluated inside the federation runtime bootstrap,
 * BEFORE the shared scope is initialized. It must therefore NOT statically
 * import any MF-shared singleton (e.g. `observability`) — doing so resolves to a
 * not-yet-ready `consume-shared` factory and throws "factory is undefined". We
 * lazy-import `observability` only when a remote actually fails, by which point
 * the app is running and the shared module resolves normally.
 */

type ErrorLoadRemoteArgs = {
  id?: string;
  error?: unknown;
  from?: "build" | "runtime";
  lifecycle?: string;
};

type RuntimePlugin = {
  name: string;
  errorLoadRemote?: (args: ErrorLoadRemoteArgs) => unknown;
};

export default function platformRemoteObservability(): RuntimePlugin {
  return {
    name: "platform-remote-observability",
    errorLoadRemote(args) {
      // Lazy (not static) import — see module header. Fire-and-forget so the
      // synchronous rethrow below still reaches the router ErrorBoundary.
      void import("observability")
        .then(({ telemetry }) => {
          telemetry.captureException(args.error, {
            scope: "module-federation",
            remote_id: args.id ?? "unknown",
            from: args.from ?? "runtime",
            lifecycle: args.lifecycle ?? "",
          });
        })
        .catch(() => {});
      // Rethrow: let the router-level ErrorBoundary render the retry fallback.
      throw args.error instanceof Error
        ? args.error
        : new Error(`Failed to load remote: ${args.id ?? "unknown"}`);
    },
  };
}
