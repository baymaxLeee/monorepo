import {
  ChatComposerControls,
  ExecutionPolicy,
  type ApprovalPolicyValue,
  type PermissionProfileValue,
} from "@repo/ai-elements/conversation";
import type { ModelProvider } from "@repo/api/admin";
import type { ReasoningEffort } from "@repo/api/chat";

export function NewConversationStartControls({
  approvalPolicy,
  permissionProfile,
  onChange,
  disabled,
}: {
  approvalPolicy: ApprovalPolicyValue;
  permissionProfile: PermissionProfileValue;
  onChange: (value: { approvalPolicy: ApprovalPolicyValue; permissionProfile: PermissionProfileValue }) => void;
  disabled?: boolean;
}) {
  return (
    <ExecutionPolicy
      approvalPolicy={approvalPolicy}
      permissionProfile={permissionProfile}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

export function NewConversationEndControls({
  models,
  selectedModelId,
  onSelectModel,
  reasoningEffort,
  onReasoningChange,
  disabled,
}: {
  models: ModelProvider[];
  selectedModelId: string | null;
  onSelectModel: (id: string) => void;
  reasoningEffort: ReasoningEffort;
  onReasoningChange: (effort: ReasoningEffort) => void;
  disabled?: boolean;
}) {
  return (
    <ChatComposerControls
      models={models}
      selectedModelId={selectedModelId}
      onSelectModel={onSelectModel}
      reasoningEffort={reasoningEffort}
      onReasoningEffortChange={onReasoningChange}
      disabled={disabled}
    />
  );
}
