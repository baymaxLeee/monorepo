import { type ConversationScrollHandle } from "@repo/ai-elements";
import { type PromptInputRef, type PromptInputValue, type PromptSlashCommand } from "@repo/ai-elements/prompt-input";
import { listSkills } from "@repo/api/admin";
import {
  callConversationAppTool,
  type ConversationFile,
  type ReasoningEffort,
  updateConversationExecutionPolicy,
  updateConversationModel,
} from "@repo/api/chat";
import { toast } from "@repo/design-system";
import { randomId } from "@repo/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { ChatComposer } from "../../components/ChatComposer";
import type { ReasoningEffort as ComposerReasoningEffort } from "../../components/ChatComposerControls";
import { ChatImagePreview } from "../../components/ChatImagePreview";
import { ChatSessionIssue } from "../../components/ChatSessionIssue";
import { ConversationSessionView } from "../../components/ConversationSessionView";
import type { ApprovalPolicyValue, PermissionProfileValue } from "../../components/ExecutionPolicy";
import { useAgentRunInputs } from "../../hooks/useAgentRunInputs";
import { useConversationChat } from "../../hooks/useConversationChat";
import { useForkConversation } from "../../hooks/useForkConversation";
import { useSourceAction } from "../../hooks/useSourceAction";
import type { ChatUIMessage } from "../../lib/chat-message";
import { buildUserFilePart } from "../../lib/file-parts";
import { createMCPAppContext } from "../../lib/mcp-app-context";
import type { ClientToolExecutor, PreparePageContext } from "../../lib/page-tools";
import { contextCompactionStatusText, modelRetryStatusText } from "../../lib/runtime-status";
import { useChatStore } from "../../store/useChatStore";

const EMPTY_ATTACHMENTS: ConversationFile[] = [];

export type ExternalChatRequest =
  | {
      id: string;
      parts: ChatUIMessage["parts"];
    }
  | { id: string; text: string };

const EMPTY_REQUEST_BODY: Record<string, unknown> = {};

export function ChatSession({
  conversationId: id,
  onCanvasChange,
  externalRequest,
  requestBody = EMPTY_REQUEST_BODY,
  clientToolExecutor,
  preparePageContext,
}: {
  conversationId: string;
  onCanvasChange?: () => void;
  externalRequest?: ExternalChatRequest | null;
  requestBody?: Record<string, unknown>;
  clientToolExecutor?: ClientToolExecutor;
  preparePageContext?: PreparePageContext;
}) {
  const forkConversation = useForkConversation(id);
  const [activatedSkillName, setActivatedSkillName] = useState<string | null>(null);
  const appContext = useMemo(() => createMCPAppContext((callId, pluginId, name, args, signal) =>
    callConversationAppTool(id, {tool_call_id: callId, plugin_id:pluginId, name, arguments: args}, {signal})
  ), [id]);
  const promptRef = useRef<PromptInputRef>(null);
  const conversationScrollRef = useRef<ConversationScrollHandle | null>(null);
  const skillCommandsCacheRef = useRef<PromptSlashCommand[] | null>(null);
  const skillRequestRef = useRef<{
    controller: AbortController;
    promise: Promise<PromptSlashCommand[]>;
  } | null>(null);
  const handledExternalRequestRef = useRef<string | null>(null);
  const { traceRefreshKey, openArtifactPreview, openFilePreview, closeArtifactPreview, closeImagePreview } =
    useChatStore(
      useShallow((s) => ({
        traceRefreshKey: s.traceRefreshKey,
        openArtifactPreview: s.openArtifactPreview,
        openFilePreview: s.openFilePreview,
        closeArtifactPreview: s.closeArtifactPreview,
        closeImagePreview: s.closeImagePreview,
      })),
    );

  useEffect(() => {
    setActivatedSkillName(null);
  }, [id]);

  useEffect(
    () => () => {
      skillRequestRef.current?.controller.abort();
    },
    [],
  );

  const loadSkills = useCallback(async (signal: AbortSignal) => {
    const cached = skillCommandsCacheRef.current;
    if (cached) {
      return cached;
    }

    let request = skillRequestRef.current;
    if (!request) {
      const controller = new AbortController();
      const promise = listSkills({
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
          skillCommandsCacheRef.current = commands;
          return commands;
        })
        .catch(() => []);
      request = { controller, promise };
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
  }, []);

  const {
    chat,
    detail,
    loading,
    historyReady,
    historyMutationPending,
    activeRunId,
    issue,
    modelRetry,
    contextCompaction,
    contextUsage,
    canRetry,
    canStartHistoryMutation,
    recover,
    retryRequest,
    stopRun,
    selectHistory,
    pendingClientContinuationRef,
  } = useConversationChat(id, clientToolExecutor, requestBody);
  const { sendMessage, regenerate, addToolOutput, addToolApprovalResponse } = chat;
  const [pageToolWaiting, setPageToolWaiting] = useState(false);
  const [status, setStatus] = useState<typeof chat.status>(chat.status);
  const runActive = status === "streaming" || status === "submitted";
  const busy =
    pageToolWaiting ||
    !historyReady ||
    historyMutationPending ||
    runActive ||
    (issue !== null && Boolean(detail?.active_run_id));
  const updateModelBinding = useCallback(
    async (providerId: string, effort: ComposerReasoningEffort) => {
      await updateConversationModel(id, {
        provider_id: providerId,
        reasoning_effort: effort as ReasoningEffort,
      });
    },
    [id],
  );
  const updateExecutionPolicy = useCallback(
    async (value: { approvalPolicy: ApprovalPolicyValue; permissionProfile: PermissionProfileValue }) => {
      await updateConversationExecutionPolicy(id, {
        approval_policy: value.approvalPolicy,
        permission_profile: value.permissionProfile,
      });
    },
    [id],
  );
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
    const parts =
      "parts" in externalRequest ? externalRequest.parts : [{ type: "text" as const, text: externalRequest.text }];
    const sent = sendMessage({ parts }, { body: requestBody });
    conversationScrollRef.current?.scrollToEnd();
    void sent.catch(() => {
      handledExternalRequestRef.current = null;
    });
  }, [canStartHistoryMutation, detail?.id, externalRequest, id, loading, requestBody, sendMessage]);

  useEffect(() => {
    closeArtifactPreview();
    closeImagePreview();
  }, [id, closeArtifactPreview, closeImagePreview]);

  const {
    acknowledgeDelivered: acknowledgeDeliveredRunInputs,
    admit: admitRunInput,
    pendingInputs,
  } = useAgentRunInputs({
    conversationId: id,
    activeRunId,
    recoveryRunId: activeRunId ?? detail?.latest_run_id ?? null,
  });

  const submit = useCallback(
    async (value: PromptInputValue) => {
      if (!id) {
        return;
      }
      const hasReadyFile = value.tokens.some((token) => typeof token.meta?.fileId === "string");
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
      if (runActive) {
        if (value.tokens.length > 0) {
          toast.add({ type: "error", title: "生成期间的补充暂不支持附件，请等待当前任务结束后发送。" });
          return;
        }
        if (activatedSkillName) {
          toast.add({ type: "error", title: "生成期间的补充不能切换技能，请等待当前任务结束后发送。" });
          return;
        }
        await admitRunInput(text, "follow-up");
        if (promptRef.current?.getValue().text === value.text) promptRef.current.clear();
        return;
      }
      if (!canStartHistoryMutation()) return;
      pendingClientContinuationRef.current = false;
      const parts = value.segments.flatMap((segment): ChatUIMessage["parts"][number][] => {
        if (segment.type === "text") {
          return segment.text ? [{ type: "text" as const, text: segment.text }] : [];
        }
        const fileId = segment.token.meta?.fileId;
        if (typeof fileId !== "string") throw new Error("请等待附件上传完成后再发送");
        return [
          buildUserFilePart({
            conversationId: id,
            fileId,
            filename: segment.token.label,
            mimeType: segment.token.mime ?? "application/octet-stream",
          }),
        ];
      });
      if (!parts.some((part) => part.type === "text")) {
        parts.push({ type: "text", text });
      }
      // `/` skill activation travels as a persisted message part: the backend derives the activated
      // skill from this part, and it durably records which skill drove the turn.
      if (activatedSkillName) {
        parts.push({
          type: "data-skill-activation",
          data: { name: activatedSkillName },
        });
      }
      promptRef.current?.clear();
      try {
        const context = appContext.prepare(preparePageContext);
        if (context) parts.push({ type: "text", text: context.text });
        const sent = sendMessage({ parts }, { body: requestBody });
        // Sending returns to the live conversation; the new user row then becomes
        // MessageScroller's turn anchor, even when the user was reading history.
        conversationScrollRef.current?.scrollToEnd();
        await sent;
        if (chat.status !== "error") context?.acknowledge();
        setActivatedSkillName(null);
      } catch (error) {
        promptRef.current?.setValue(value);
        throw error;
      }
    },
    [
      activatedSkillName,
      admitRunInput,
      appContext,
      canStartHistoryMutation,
      chat,
      id,
      preparePageContext,
      requestBody,
      runActive,
      sendMessage,
    ],
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
      await sendMessage({ id: randomId().replaceAll("-", ""), messageId, parts }, { body: requestBody });
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
  return (
    <ConversationSessionView
      promptRef={promptRef}
      appContext={appContext}
      title={detail?.title ?? "新对话"}
      onFork={forkConversation}
      chat={chat}
      resume={!loading && detail?.id === id && Boolean(detail.active_run_id)}
      runActive={runActive}
      conversationId={id}
      loading={loading}
      branches={detail?.branches ?? []}
      pendingInputs={pendingInputs}
      onPageToolWaiting={setPageToolWaiting}
      onPendingInputsDelivered={acknowledgeDeliveredRunInputs}
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
      issue={
        issue ? (
          <ChatSessionIssue
            issue={issue}
            onRecover={recover}
            onRetry={canRetry ? retryRequest : undefined}
            onStop={stopRun}
          />
        ) : modelRetry ? (
          <p
            role={modelRetry.state === "retrying" ? "status" : "alert"}
            className="mx-auto w-full max-w-4xl px-4 text-sm text-muted-foreground"
          >
            {modelRetryStatusText(modelRetry)}
          </p>
        ) : contextCompaction ? (
          <p role="status" className="mx-auto w-full max-w-4xl px-4 text-sm text-muted-foreground">
            {contextCompactionStatusText(contextCompaction)}
          </p>
        ) : null
      }
      composer={(activePlan) => (
        <ChatComposer
          id={id}
          promptRef={promptRef}
          attachments={detail?.attachments ?? EMPTY_ATTACHMENTS}
          initialModelId={detail?.provider_id || null}
          initialReasoningEffort={(detail?.reasoning_effort as ComposerReasoningEffort | undefined) ?? "medium"}
          onUpdateModelBinding={updateModelBinding}
          initialApprovalPolicy={(detail?.approval_policy as ApprovalPolicyValue | undefined) ?? "on-request"}
          initialPermissionProfile={(detail?.permission_profile as PermissionProfileValue | undefined) ?? ":workspace"}
          onUpdateExecutionPolicy={updateExecutionPolicy}
          busy={busy}
          runActive={runActive && !pageToolWaiting}
          activatedSkillName={activatedSkillName}
          setActivatedSkillName={setActivatedSkillName}
          traceRefreshKey={traceRefreshKey}
          contextUsage={contextUsage}
          loadSkills={loadSkills}
          onSubmit={submit}
          onStop={stopRun}
          activePlan={activePlan}
        />
      )}
      overlay={<ChatImagePreview />}
    />
  );
}
