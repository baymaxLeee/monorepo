import { ContextUsage } from "@repo/ai-elements";
import { ChatComposerControls, ExecutionPolicy } from "@repo/ai-elements/conversation";
import type { LocalThread } from "@repo/runtime/desktop";

type LocalComposerState = Pick<
  LocalThread,
  "providerId" | "reasoningEffort" | "approvalPolicy" | "permissionProfile" | "status" | "contextUsage"
>;

export function LocalComposerStartControls({
  state,
  busy,
  onExecutionPolicyChange,
}: {
  state: LocalComposerState;
  busy: boolean;
  onExecutionPolicyChange: (
    approvalPolicy: LocalThread["approvalPolicy"],
    permissionProfile: LocalThread["permissionProfile"],
  ) => void;
}) {
  return (
    <>
      <ExecutionPolicy
        approvalPolicy={state.approvalPolicy}
        permissionProfile={state.permissionProfile}
        disabled={busy || state.status === "waiting"}
        onChange={({ approvalPolicy, permissionProfile }) => onExecutionPolicyChange(approvalPolicy, permissionProfile)}
      />
      <ContextUsage value={state.contextUsage} loading={busy} />
    </>
  );
}

export function LocalComposerEndControls({
  models,
  fallbackModel,
  state,
  busy,
  onModelChange,
  onReasoningChange,
}: {
  models: ReadonlyArray<{ id: string; name: string; model?: string }>;
  fallbackModel: { id: string; name: string; model?: string };
  state: LocalComposerState;
  busy: boolean;
  onModelChange: (providerId: string) => void;
  onReasoningChange: (reasoningEffort: LocalThread["reasoningEffort"]) => void;
}) {
  return (
    <ChatComposerControls
      models={models.length > 0 ? models : [fallbackModel]}
      selectedModelId={state.providerId}
      onSelectModel={onModelChange}
      reasoningEffort={state.reasoningEffort}
      onReasoningEffortChange={onReasoningChange}
      disabled={busy || state.status === "waiting"}
    />
  );
}
