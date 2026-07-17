import { isTaskCancelled } from "./notify.js";

const CANCELLATION_POLL_MS = 250;

export function observeTaskCancellation(workflowRunId: string): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  let disposed = false;
  let checking = false;
  const check = async () => {
    if (disposed || checking || controller.signal.aborted) return;
    checking = true;
    try {
      if (await isTaskCancelled(workflowRunId)) {
        controller.abort(new DOMException("task cancelled", "AbortError"));
      }
    } catch (error) {
      console.error("[executor] cancellation status check failed", {
        workflowRunId,
        error,
      });
    } finally {
      checking = false;
    }
  };
  void check();
  const timer = setInterval(() => void check(), CANCELLATION_POLL_MS);
  return {
    signal: controller.signal,
    dispose: () => {
      disposed = true;
      clearInterval(timer);
    },
  };
}
