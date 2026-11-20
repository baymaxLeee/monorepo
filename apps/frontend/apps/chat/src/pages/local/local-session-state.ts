import type { LocalThread } from "@repo/runtime/desktop";

export function localSessionState(thread: LocalThread) {
  return {
    title: thread.title,
    status: thread.status,
    turnId: thread.turnId,
    error: thread.error,
    pendingInputs: thread.pendingInputs,
    providerId: thread.providerId,
    reasoningEffort: thread.reasoningEffort,
    contextUsage: thread.contextUsage,
    approvalPolicy: thread.approvalPolicy,
    permissionProfile: thread.permissionProfile,
  };
}
