import { type ConversationScrollHandle } from "@repo/ai-elements";
import { type PromptInputRef, type PromptInputValue, type PromptSlashCommand } from "@repo/ai-elements/prompt-input";
import { type ConversationDocument, fetchBotSkills } from "@repo/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { ChatComposer } from "../../components/ChatComposer";
import { ChatImagePreview } from "../../components/ChatImagePreview";
import { ChatSessionIssue } from "../../components/ChatSessionIssue";
import { ChatStream } from "../../components/ChatStream";
import { useConversationChat } from "../../hooks/useConversationChat";
import { useForkConversation } from "../../hooks/useForkConversation";
import { useSourceAction } from "../../hooks/useSourceAction";
import type { ChatUIMessage } from "../../lib/chat-message";
import { buildUserFilePart } from "../../lib/file-parts";
import { useChatStore } from "../../store/useChatStore";

const EMPTY_DOCUMENTS: ConversationDocument[] = [];

export function ChatSession({
  conversationId: id,
  onCanvasChange,
  externalRequest,
}: {
  conversationId: string;
  onCanvasChange?: () => void;
  externalRequest?: { id: string; text: string } | null;
}) {
  const forkConversation = useForkConversation(id);
  const [mode, setMode] = useState<"normal" | "plan">("normal");
  const [activatedSkillName, setActivatedSkillName] = useState<string | null>(null);
  const promptRef = useRef<PromptInputRef>(null);
  const conversationScrollRef = useRef<ConversationScrollHandle | null>(null);
  const skillCommandsCacheRef = useRef(new Map<string, PromptSlashCommand[]>());
  const skillRequestRef = useRef<{
    agentId: string;
    controller: AbortController;
    promise: Promise<PromptSlashCommand[]>;
  } | null>(null);
  const handledExternalRequestRef = useRef<string | null>(null);
  const {
    agents,
    selectedAgentId,
    setSelectedAgentId,
    traceRefreshKey,
    openArtifactPreview,
    openFilePreview,
    closeArtifactPreview,
    closeImagePreview,
  } = useChatStore(
    useShallow((s) => ({
      agents: s.agents,
      selectedAgentId: s.selectedAgentId,
      setSelectedAgentId: s.setSelectedAgentId,
      traceRefreshKey: s.traceRefreshKey,
      openArtifactPreview: s.openArtifactPreview,
      openFilePreview: s.openFilePreview,
      closeArtifactPreview: s.closeArtifactPreview,
      closeImagePreview: s.closeImagePreview,
    })),
  );

  const requestBody = useMemo(
    () => ({
      agent_id: selectedAgentId ?? null,
      mode,
    }),
    [selectedAgentId, mode],
  );

  useEffect(() => {
    setActivatedSkillName(null);
    if (skillRequestRef.current && skillRequestRef.current.agentId !== selectedAgentId) {
      skillRequestRef.current.controller.abort();
      skillRequestRef.current = null;
    }
  }, [selectedAgentId]);

  useEffect(
    () => () => {
      skillRequestRef.current?.controller.abort();
    },
    [],
  );

  const loadSkills = useCallback(
    async (signal: AbortSignal) => {
      const agentId = selectedAgentId;
      if (!agentId) {
        return [];
      }
      const cached = skillCommandsCacheRef.current.get(agentId);
      if (cached) {
        return cached;
      }

      let request = skillRequestRef.current;
      if (!request || request.agentId !== agentId) {
        request?.controller.abort();
        const controller = new AbortController();
        const promise = fetchBotSkills(agentId, {
          signal: controller.signal,
          skipErrorNotify: true,
        })
          .then((list) =>
            list
              .filter((skill) => skill.is_enabled && skill.status === "published")
              .map((skill) => ({
                id: skill.name,
                title: skill.name,
                description: skill.description,
              })),
          )
          .then((commands) => {
            skillCommandsCacheRef.current.set(agentId, commands);
            return commands;
          })
          .catch(() => []);
        request = { agentId, controller, promise };
        skillRequestRef.current = request;
        void promise.finally(() => {
          if (skillRequestRef.current?.controller === controller) {
            skillRequestRef.current = null;
          }
        });
      }

      const list = await request.promise;
      if (signal.aborted) {
        return [];
      }
      return list;
    },
    [selectedAgentId],
  );

  const {
    chat,
    detail,
    loading,
    historyReady,
    historyMutationPending,
    issue,
    canRetry,
    canStartHistoryMutation,
    recover,
    retryRequest,
    stopRun,
    selectHistory,
    pendingClientContinuationRef,
  } = useConversationChat(id);
  const { sendMessage, regenerate, addToolOutput, addToolApprovalResponse } = chat;
  const [status, setStatus] = useState<typeof chat.status>(chat.status);
  const busy =
    !historyReady ||
    historyMutationPending ||
    status === "streaming" ||
    status === "submitted" ||
    (issue !== null && Boolean(detail?.active_run_id));
  useEffect(() => {
    void useChatStore.getState().loadAgents();
  }, []);
  useEffect(() => {
    if (
      !externalRequest ||
      !id ||
      loading ||
      !canStartHistoryMutation() ||
      detail?.id !== id ||
      chat.status === "streaming" ||
      chat.status === "submitted" ||
      handledExternalRequestRef.current === externalRequest.id
    ) {
      return;
    }
    handledExternalRequestRef.current = externalRequest.id;
    pendingClientContinuationRef.current = false;
    const sent = sendMessage(
      { parts: [{ type: "text", text: externalRequest.text }] },
      { body: { ...requestBody, mode: "normal" as const } },
    );
    conversationScrollRef.current?.scrollToEnd();
    void sent.catch(() => {
      handledExternalRequestRef.current = null;
    });
  }, [canStartHistoryMutation, detail?.id, externalRequest, id, loading, requestBody, sendMessage]);

  useEffect(() => {
    closeArtifactPreview();
    closeImagePreview();
  }, [id, closeArtifactPreview, closeImagePreview]);

  const submit = useCallback(
    async (value: PromptInputValue) => {
      if (!id || !canStartHistoryMutation()) {
        return;
      }
      pendingClientContinuationRef.current = false;
      const hasReadyFile = value.tokens.some((token) => typeof token.meta?.artifactId === "string");
      // `value.text` embeds `[[tokenId]]` placeholders for tokens; derive the real
      // typed text from text segments so an attachment-only send falls back to the
      // friendly prompt instead of shipping a raw `[[id]]` placeholder as content.
      const typedText = value.segments
        .filter((segment) => segment.type === "text")
        .map((segment) => segment.text)
        .join("")
        .trim();
      const text = typedText || (hasReadyFile ? "请阅读并处理我附加的文件。" : "");
      if (!text) {
        return;
      }
      const parts = value.segments.flatMap((segment): ChatUIMessage["parts"][number][] => {
        if (segment.type === "text") {
          return segment.text ? [{ type: "text" as const, text: segment.text }] : [];
        }
        const documentId = segment.token.meta?.artifactId;
        const assetId = segment.token.meta?.assetId;
        const revisionId = segment.token.meta?.revisionId;
        if (typeof documentId !== "string" || typeof assetId !== "string" || typeof revisionId !== "string" || !id) {
          return [];
        }
        return [
          buildUserFilePart({
            conversationId: id,
            documentId,
            assetId,
            revisionId,
            filename: segment.token.label,
            mimeType: segment.token.mime ?? "application/octet-stream",
          }),
        ];
      });
      if (!parts.some((part) => part.type === "text")) {
        parts.push({ type: "text", text });
      }
      // `/` skill activation travels as a persisted message part (one channel,
      // two roles like data-plan-execution): the backend derives the activated
      // skill from this part, and it durably records which skill drove the turn.
      if (activatedSkillName) {
        parts.push({
          type: "data-skill-activation",
          data: { name: activatedSkillName },
        });
      }
      promptRef.current?.clear();
      try {
        const sent = sendMessage({ parts }, { body: requestBody });
        // Sending returns to the live conversation; the new user row then becomes
        // MessageScroller's turn anchor, even when the user was reading history.
        conversationScrollRef.current?.scrollToEnd();
        await sent;
        setActivatedSkillName(null);
      } catch (error) {
        promptRef.current?.setValue(value);
        throw error;
      }
    },
    [activatedSkillName, canStartHistoryMutation, id, requestBody, sendMessage],
  );

  const changeMode = useCallback(
    (nextMode: "normal" | "plan") => {
      if (chat.status === "streaming" || chat.status === "submitted" || nextMode === mode) {
        return;
      }
      // Mode is an ephemeral per-run input carried in the run request body
      // (`requestBody.mode`); it is not persisted server-side (ADR-0035).
      setMode(nextMode);
    },
    [chat, mode],
  );

  const executePlan = useCallback(
    async (fileId: string) => {
      if (!id || !canStartHistoryMutation()) {
        return;
      }
      setMode("normal");
      // Execute in normal mode this turn. `requestBody` still reflects the
      // pre-update render (mode may be "plan"), so pin mode explicitly; the plan
      // reference travels as the persisted `data-plan-execution` part.
      const sent = sendMessage(
        {
          parts: [
            { type: "text", text: "请按照这个计划开始执行。" },
            { type: "data-plan-execution", data: { file_id: fileId } },
          ] as ChatUIMessage["parts"],
        },
        { body: { ...requestBody, mode: "normal" as const } },
      );
      conversationScrollRef.current?.scrollToEnd();
      await sent;
    },
    [canStartHistoryMutation, id, requestBody, sendMessage],
  );

  const answerClientTool = useCallback(
    (toolName: string, toolCallId: string, output: unknown) => {
      if (!canStartHistoryMutation()) return;
      pendingClientContinuationRef.current = true;
      addToolOutput({
        tool: toolName,
        toolCallId,
        output: toolName === "ask_user" ? { ok: true, status: "completed", data: output } : output,
        options: { body: requestBody },
      });
    },
    [addToolOutput, canStartHistoryMutation, requestBody],
  );

  const openArtifact = useCallback(
    (documentId: string) => {
      if (!id) {
        return;
      }
      openArtifactPreview(id, documentId);
    },
    [id, openArtifactPreview],
  );

  const openFile = useCallback(
    (fileId: string) => {
      if (!id) {
        return;
      }
      openFilePreview(id, fileId);
    },
    [id, openFilePreview],
  );

  const approveTool = useCallback(
    (approvalId: string, approved: boolean) => {
      if (!canStartHistoryMutation()) return;
      pendingClientContinuationRef.current = true;
      void addToolApprovalResponse({ id: approvalId, approved, options: { body: requestBody } });
    },
    [addToolApprovalResponse, canStartHistoryMutation, requestBody],
  );
  const editMessage = useCallback(
    async (messageId: string, parts: ChatUIMessage["parts"]) => {
      if (!canStartHistoryMutation()) return;
      pendingClientContinuationRef.current = false;
      conversationScrollRef.current?.scrollToEnd();
      await sendMessage({ id: crypto.randomUUID().replaceAll("-", ""), messageId, parts }, { body: requestBody });
    },
    [canStartHistoryMutation, pendingClientContinuationRef, requestBody, sendMessage],
  );
  const regenerateMessage = useCallback(
    async (messageId: string) => {
      if (!canStartHistoryMutation()) return;
      pendingClientContinuationRef.current = false;
      conversationScrollRef.current?.scrollToEnd();
      await regenerate({ messageId, body: requestBody });
    },
    [canStartHistoryMutation, pendingClientContinuationRef, regenerate, requestBody],
  );
  const resolveSourceAction = useSourceAction(id);
  const handleExecutePlan = useCallback((fileId: string) => void executePlan(fileId).catch(() => {}), [executePlan]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-center px-14">
        <h1 className="max-w-full truncate text-sm font-medium text-foreground">{detail?.title ?? "新对话"}</h1>
      </header>

      <ChatStream
        onFork={forkConversation}
        chat={chat}
        resume={!loading && detail?.id === id && Boolean(detail.active_run_id)}
        conversationId={id}
        loading={loading}
        conversationDocuments={detail?.documents ?? EMPTY_DOCUMENTS}
        branches={detail?.branches ?? []}
        scrollRef={conversationScrollRef}
        onStatusChange={setStatus}
        onCanvasChange={onCanvasChange}
        onOpenArtifact={openArtifact}
        onOpenFile={openFile}
        resolveSourceAction={resolveSourceAction}
        onSelectBranch={selectHistory}
        onEditMessage={editMessage}
        onRegenerate={regenerateMessage}
        onAnswerClientTool={answerClientTool}
        onToolApproval={approveTool}
        onExecutePlan={handleExecutePlan}
      />

      {issue && (
        <ChatSessionIssue
          issue={issue}
          onRecover={recover}
          onRetry={canRetry ? retryRequest : undefined}
          onStop={stopRun}
        />
      )}
      <ChatComposer
        id={id}
        promptRef={promptRef}
        documents={detail?.documents ?? EMPTY_DOCUMENTS}
        agents={agents}
        selectedAgentId={selectedAgentId}
        setSelectedAgentId={setSelectedAgentId}
        busy={busy}
        mode={mode}
        activatedSkillName={activatedSkillName}
        setActivatedSkillName={setActivatedSkillName}
        traceRefreshKey={traceRefreshKey}
        loadSkills={loadSkills}
        onSubmit={submit}
        onStop={stopRun}
        onModeChange={changeMode}
      />
      <ChatImagePreview />
    </div>
  );
}
