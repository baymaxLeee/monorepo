import { type PromptInputRef, type PromptInputValue, type PromptSlashCommand } from "@repo/ai-elements/prompt-input";
import { listProviders, type ModelProvider } from "@repo/api/admin";
import { type ConversationDocument } from "@repo/api/chat";
import { toast } from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { memo, type RefObject, useEffect, useState } from "react";

import { uploadConversationFiles } from "../lib/upload-conversation-files";
import { ChatComposerControls, type ReasoningEffort } from "./ChatComposerControls";
import { ChatContextUsage } from "./ChatContextUsage";
import { ChatPrompt } from "./ChatPrompt";
import type { ApprovalPolicyValue, PermissionProfileValue } from "./ExecutionPolicy";

type ChatComposerProps = {
  id: string;
  promptRef: RefObject<PromptInputRef | null>;
  documents: ConversationDocument[];
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
};

export const ChatComposer = memo(function ChatComposer({
  id,
  promptRef,
  documents,
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
        void uploadConversationFiles({
          conversationId: id,
          providerId: selectedModelId ?? undefined,
          items,
        })
          .then((result) => {
            for (const { client_ref: clientRef, document } of result.documents) {
              promptRef.current?.updateToken(clientRef, {
                status: document.ingest_status === "failed" ? "failed" : "ready",
                meta: {
                  artifactId: document.id,
                  assetId: document.asset_id,
                  revisionId: document.source_revision_id,
                  ingestStatus: document.ingest_status ?? "received",
                },
              });
            }
            for (const failure of result.failed ?? []) {
              promptRef.current?.updateToken(failure.client_ref, {
                status: "failed",
                error: failure.error,
                meta: {
                  artifactId: failure.artifact_id ?? undefined,
                  ingestStatus: "failed",
                  ingestError: failure.error,
                },
              });
              toast.add({ type: "error", title: `上传失败：${failure.error}` });
            }
          })
          .catch((error) => {
            const message = getErrorMessage(error);
            for (const { token } of items) {
              promptRef.current?.updateToken(token.id, {
                status: "failed",
                error: message,
                meta: {
                  ingestStatus: "failed",
                  ingestError: message,
                },
              });
            }
            toast.add({ type: "error", title: message });
          });
      }}
      onSubmit={(value) =>
        void onSubmit(value).catch((error: unknown) => {
          toast.add({ type: "error", title: getErrorMessage(error) });
        })
      }
      mentionSource={(query) => {
        const q = query.trim().toLowerCase();
        return documents
          .filter((document) => document.ingest_status !== "failed")
          .filter((document) => !q || (document.filename || document.title).toLowerCase().includes(q))
          .slice(0, 8)
          .map((document) => ({
            id: document.id,
            label: document.filename || document.title,
            kind: (document.mime_type ?? "").startsWith("image/") ? "image" : "file",
            mime: document.mime_type,
            meta: {
              artifactId: document.id,
              assetId: document.asset_id,
              revisionId: document.source_revision_id,
            },
          }));
      }}
      onSkillsLoad={loadSkills}
      onSlashCommand={(command) => {
        setActivatedSkillName(command.id);
        toast.add({ title: `已选择技能：${command.title}` });
      }}
      footerRender={() => (
        <>
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
            approvalPolicy={approvalPolicy}
            permissionProfile={permissionProfile}
            onExecutionPolicyChange={(value) => {
              void onUpdateExecutionPolicy(value).then(() => {
                setApprovalPolicy(value.approvalPolicy);
                setPermissionProfile(value.permissionProfile);
              });
            }}
            activatedSkillName={activatedSkillName}
            onClearSkill={() => setActivatedSkillName(null)}
            disabled={busy}
          />
          <ChatContextUsage conversationId={id ?? ""} refreshKey={traceRefreshKey} running={busy} />
        </>
      )}
    />
  );
});
