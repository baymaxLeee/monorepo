import { type PromptInputRef, type PromptInputValue, type PromptSlashCommand } from "@repo/ai-elements/prompt-input";
import { authFetch } from "@repo/api";
import { type Bot } from "@repo/api/admin";
import { type ConversationDocument } from "@repo/api/chat";
import { ingestDocuments, prepareIngest } from "@repo/api/knowledge";
import { toast } from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { memo, type RefObject } from "react";

import { ChatComposerControls } from "./ChatComposerControls";
import { ChatContextUsage } from "./ChatContextUsage";
import { ChatPrompt } from "./ChatPrompt";
import type { PendingAgentInput } from "./PendingInputStack";

type ChatComposerProps = {
  id: string;
  promptRef: RefObject<PromptInputRef | null>;
  documents: ConversationDocument[];
  agents: Bot[] | null;
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
  busy: boolean;
  runActive: boolean;
  pendingInputs: readonly PendingAgentInput[];
  mode: "normal" | "plan";
  activatedSkillName: string | null;
  setActivatedSkillName: (name: string | null) => void;
  traceRefreshKey: number;
  loadSkills: (signal: AbortSignal) => Promise<PromptSlashCommand[]>;
  onSubmit: (value: PromptInputValue) => Promise<void>;
  onStop: () => Promise<void>;
  onModeChange: (mode: "normal" | "plan") => void;
};

export const ChatComposer = memo(function ChatComposer({
  id,
  promptRef,
  documents,
  agents,
  selectedAgentId,
  setSelectedAgentId,
  busy,
  runActive,
  pendingInputs,
  mode,
  activatedSkillName,
  setActivatedSkillName,
  traceRefreshKey,
  loadSkills,
  onSubmit,
  onStop,
  onModeChange,
}: ChatComposerProps) {
  return (
    <ChatPrompt
      ref={promptRef}
      disabled={false}
      loading={busy}
      submitWhileLoading={runActive}
      pendingInputs={pendingInputs}
      placeholder={
        runActive
          ? "补充当前任务…"
          : mode === "plan"
            ? "描述要规划的任务，/ 引用技能，@ 添加上下文"
            : "发送消息或创建任务…"
      }
      maxFiles={8}
      maxFileSize={10 * 1024 * 1024}
      onError={(message) => toast.add({ type: "error", title: message })}
      onStop={() => void onStop()}
      onFilesAdded={(items) => {
        if (!id) {
          return;
        }
        void prepareIngest({
          conversation_id: id,
          files: items.map(({ token, file }) => ({
            client_ref: token.id,
            filename: file.name,
            media_type: file.type || "application/octet-stream",
            size_bytes: file.size,
          })),
        })
          .then(async (prepared) => {
            await Promise.all(
              prepared.uploads.map(async (plan) => {
                const file = items.find(({ token }) => token.id === plan.client_ref)?.file;
                if (!file) throw new Error(`missing upload source: ${plan.client_ref}`);
                const response = await authFetch(plan.upload_url, {
                  method: "PUT",
                  headers: { "Content-Type": file.type || "application/octet-stream" },
                  body: file,
                });
                if (!response.ok) throw new Error(`upload failed: ${response.status}`);
              }),
            );
            return ingestDocuments({
              conversation_id: id,
              provider_id: agents?.find((agent) => agent.id === selectedAgentId)?.text_provider_id ?? undefined,
              uploads: prepared.uploads.map((plan) => ({
                client_ref: plan.client_ref,
                upload_session_id: plan.upload_session_id,
              })),
            });
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
            agents={agents ?? []}
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
            activatedSkillName={activatedSkillName}
            onClearSkill={() => setActivatedSkillName(null)}
            mode={mode}
            onModeChange={onModeChange}
            disabled={busy && !runActive}
          />
          <ChatContextUsage conversationId={id ?? ""} refreshKey={traceRefreshKey} running={busy} />
        </>
      )}
    />
  );
});
