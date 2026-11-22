import { type PromptInputRef, type PromptInputValue, type PromptSlashCommand } from "@repo/ai-elements/prompt-input";
import { listProviders, type ModelProvider } from "@repo/api/admin";
import { type ConversationFile } from "@repo/api/chat";
import { Badge, toast } from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { XIcon } from "lucide-react";
import { memo, type RefObject, useEffect, useState } from "react";

import { uploadConversationFile } from "../lib/upload-conversation-file";
import { ChatComposerControls, type ReasoningEffort } from "./ChatComposerControls";
import { ChatContextUsage } from "./ChatContextUsage";
import type { ActiveTodoList } from "./ChatPlanState";
import { ChatPrompt } from "./ChatPrompt";
import { ExecutionPolicy, type ApprovalPolicyValue, type PermissionProfileValue } from "./ExecutionPolicy";

type ChatComposerProps = {
  id: string;
  promptRef: RefObject<PromptInputRef | null>;
  attachments: ConversationFile[];
  initialModelId: string | null;
  initialReasoningEffort: ReasoningEffort;
  onUpdateModelBinding: (id: string, effort: ReasoningEffort) => Promise<void>;
  initialApprovalPolicy: ApprovalPolicyValue;
  initialPermissionProfile: PermissionProfileValue;
  onUpdateExecutionPolicy: (value: {
    approvalPolicy: ApprovalPolicyValue;
    permissionProfile: PermissionProfileValue;
  }) => Promise<void>;
  busy: boolean;
  runActive: boolean;
  activatedSkillName: string | null;
  setActivatedSkillName: (name: string | null) => void;
  traceRefreshKey: number;
  loadSkills: (signal: AbortSignal) => Promise<PromptSlashCommand[]>;
  onSubmit: (value: PromptInputValue) => Promise<void>;
  onStop: () => Promise<void>;
  activePlan?: ActiveTodoList | null;
};

export const ChatComposer = memo(function ChatComposer({
  id,
  promptRef,
  attachments,
  initialModelId,
  initialReasoningEffort,
  onUpdateModelBinding,
  initialApprovalPolicy,
  initialPermissionProfile,
  onUpdateExecutionPolicy,
  busy,
  runActive,
  activatedSkillName,
  setActivatedSkillName,
  traceRefreshKey,
  loadSkills,
  onSubmit,
  onStop,
  activePlan,
}: ChatComposerProps) {
  const [models, setModels] = useState<ModelProvider[]>([]);
  const [selectedModelId, setSelectedModelId] = useState(initialModelId);
  const [reasoningEffort, setReasoningEffort] = useState(initialReasoningEffort);
  const [approvalPolicy, setApprovalPolicy] = useState(initialApprovalPolicy);
  const [permissionProfile, setPermissionProfile] = useState(initialPermissionProfile);

  useEffect(() => {
    setSelectedModelId(initialModelId);
    setReasoningEffort(initialReasoningEffort);
    setApprovalPolicy(initialApprovalPolicy);
    setPermissionProfile(initialPermissionProfile);
  }, [id, initialApprovalPolicy, initialModelId, initialPermissionProfile, initialReasoningEffort]);

  useEffect(() => {
    const controller = new AbortController();
    void listProviders({ signal: controller.signal, skipErrorNotify: true })
      .then((providers) =>
        setModels(providers.filter((provider) => provider.provider_kind === "chat" && provider.is_enabled)),
      )
      .catch(() => setModels([]));
    return () => controller.abort();
  }, []);

  return (
    <ChatPrompt
      ref={promptRef}
      activePlan={activePlan}
      disabled={false}
      loading={busy}
      submitWhileLoading={runActive}
      placeholder={runActive ? "补充当前任务…" : "发送消息或创建任务…"}
      maxFiles={8}
      maxFileSize={10 * 1024 * 1024}
      onError={(message) => toast.add({ type: "error", title: message })}
      onStop={() => void onStop()}
      onFilesAdded={(items) => {
        if (!id) {
          return;
        }
        for (const { token, file } of items) {
          void uploadConversationFile(id, token.id, file)
            .then((attachment) => {
              promptRef.current?.updateToken(token.id, {
                status: "ready",
                label: attachment.filename,
                mime: attachment.mime_type,
                meta: { fileId: attachment.id },
              });
            })
            .catch((cause) => {
              const error = getErrorMessage(cause);
              promptRef.current?.updateToken(token.id, { status: "failed", error });
              toast.add({ type: "error", title: error });
            });
        }
      }}
      onSubmit={(value) =>
        void onSubmit(value).catch((error: unknown) => {
          toast.add({ type: "error", title: getErrorMessage(error) });
        })
      }
      mentionSource={(query) => {
        const q = query.trim().toLowerCase();
        return attachments
          .filter((file) => !q || file.filename.toLowerCase().includes(q))
          .slice(0, 8)
          .map((file) => ({
            id: file.id,
            label: file.filename,
            kind: file.mime_type.startsWith("image/") ? "image" : "file",
            mime: file.mime_type,
            meta: { fileId: file.id },
          }));
      }}
      onSkillsLoad={loadSkills}
      onSlashCommand={(command) => {
        setActivatedSkillName(command.id);
        toast.add({ title: `已选择技能：${command.title}` });
      }}
      toolbarRender={
        activatedSkillName
          ? () => (
              <div className="px-3 pt-2">
                <Badge variant="secondary" className="h-7 gap-1 rounded-full pr-1.5 pl-2.5">
                  <span className="font-mono text-xs">{activatedSkillName}</span>
                  <button
                    type="button"
                    aria-label="取消技能"
                    className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                    onClick={() => setActivatedSkillName(null)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              </div>
            )
          : undefined
      }
      footerStartRender={() => (
        <>
          <ExecutionPolicy
            approvalPolicy={approvalPolicy}
            permissionProfile={permissionProfile}
            onChange={(value) => {
              void onUpdateExecutionPolicy(value).then(() => {
                setApprovalPolicy(value.approvalPolicy);
                setPermissionProfile(value.permissionProfile);
              });
            }}
            disabled={busy}
          />
          <ChatContextUsage conversationId={id ?? ""} refreshKey={traceRefreshKey} running={busy} />
        </>
      )}
      footerEndRender={() => (
        <ChatComposerControls
          models={models}
          selectedModelId={selectedModelId}
          onSelectModel={(providerId) => {
            void onUpdateModelBinding(providerId, reasoningEffort).then(() => setSelectedModelId(providerId));
          }}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={(effort) => {
            if (!selectedModelId) return;
            void onUpdateModelBinding(selectedModelId, effort).then(() => setReasoningEffort(effort));
          }}
          disabled={busy}
        />
      )}
    />
  );
});
