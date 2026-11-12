import {
  PromptInput as RichPromptInput,
  type PromptInputRef,
  type PromptInputValue,
  type PromptSlashCommand,
} from "@repo/ai-elements/prompt-input";
import { type Bot, type ConversationDocument, ingestConversationDocuments } from "@repo/api";
import { toast } from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { memo, type RefObject } from "react";

import { ChatComposerControls } from "./ChatComposerControls";
import { ChatContextUsage } from "./ChatContextUsage";

type ChatComposerProps = {
  id: string;
  promptRef: RefObject<PromptInputRef | null>;
  documents: ConversationDocument[];
  agents: Bot[] | null;
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
  busy: boolean;
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
    <footer className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-2 pb-4">
      <RichPromptInput
        ref={promptRef}
        disabled={false}
        loading={busy}
        placeholder={mode === "plan" ? "描述要规划的任务，/ 引用技能，@ 添加上下文" : "要求后续变更"}
        maxFiles={8}
        maxFileSize={10 * 1024 * 1024}
        onError={(message) => toast.add({ type: "error", title: message })}
        onStop={() => void onStop()}
        onFilesAdded={(items) => {
          if (!id) {
            return;
          }
          void ingestConversationDocuments(
            id,
            items.map(({ token, file }) => ({
              clientRef: token.id,
              file,
            })),
            {
              providerId: agents?.find((a) => a.id === selectedAgentId)?.text_provider_id ?? undefined,
            },
          )
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
              for (const failure of result.failed) {
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
        onSubmit={(value) => void onSubmit(value).catch(() => {})}
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
              disabled={busy}
            />
            <ChatContextUsage conversationId={id ?? ""} refreshKey={traceRefreshKey} running={busy} />
          </>
        )}
      />
    </footer>
  );
});
