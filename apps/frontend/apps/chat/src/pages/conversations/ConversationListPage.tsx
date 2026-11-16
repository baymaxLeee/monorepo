import {
  ApprovalMode,
  ChatComposerControls,
  ChatPrompt,
  NewConversationEnvironment,
  type ApprovalModeValue,
  type ChatUIMessage,
} from "@repo/ai-elements/conversation";
import { buildUserFilePart } from "@repo/ai-elements/conversation/lib/file-parts";
import { uploadConversationFiles } from "@repo/ai-elements/conversation/lib/upload-conversation-files";
import { useChatStore } from "@repo/ai-elements/conversation/store/useChatStore";
import type { PromptInputRef, PromptInputValue } from "@repo/ai-elements/prompt-input";
import { createConversation, getLocalInferenceConfig, type GetLocalInferenceConfig200 } from "@repo/api/chat";
import { getDesktopBridge } from "@repo/runtime/desktop";
import { getErrorMessage, randomId } from "@repo/shared";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export function ConversationListPage() {
  const bridge = getDesktopBridge();
  const navigate = useNavigate();
  const [location, setLocation] = useState<"cloud" | "local">(() => (bridge ? "local" : "cloud"));
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [selectingProject, setSelectingProject] = useState(false);
  const [approvalMode, setApprovalMode] = useState<ApprovalModeValue>("auto");
  const [mode, setMode] = useState<"normal" | "plan">("normal");
  const [localInference, setLocalInference] = useState<GetLocalInferenceConfig200 | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const promptRef = useRef<PromptInputRef>(null);
  const [error, setError] = useState<string | null>(null);
  const agents = useChatStore((state) => state.agents);
  const selectedAgentId = useChatStore((state) => state.selectedAgentId);
  const setSelectedAgentId = useChatStore((state) => state.setSelectedAgentId);

  useEffect(() => {
    void useChatStore.getState().loadAgents();
  }, []);

  useEffect(() => {
    if (!bridge) return;
    const controller = new AbortController();
    void bridge
      .listThreads()
      .then((threads) => {
        if (controller.signal.aborted) return;
        const existing = [...new Set(threads.map((thread) => thread.workspace))];
        setProjects(existing);
        setProject((current) => current ?? existing[0] ?? null);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(getErrorMessage(cause));
      });
    void getLocalInferenceConfig(undefined, { signal: controller.signal, skipErrorNotify: true })
      .then((config) => {
        if (!controller.signal.aborted) setLocalInference(config);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [bridge]);

  async function createProject() {
    if (!bridge || selectingProject) return;
    setSelectingProject(true);
    setError(null);
    try {
      const selected = await bridge.selectWorkspace();
      if (!selected) return;
      setProjects((current) => [selected, ...current.filter((item) => item !== selected)]);
      setProject(selected);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setSelectingProject(false);
    }
  }

  async function prepareCloudRequest(conversationId: string, value: PromptInputValue) {
    const items = value.tokens.flatMap((token) => {
      const file = value.files[token.id];
      return file ? [{ token, file }] : [];
    });
    const uploaded =
      items.length > 0
        ? await uploadConversationFiles({
            conversationId,
            providerId: agents?.find((agent) => agent.id === selectedAgentId)?.text_provider_id ?? undefined,
            items,
          })
        : null;
    if (uploaded?.failed?.length) {
      throw new Error(uploaded.failed.map((failure) => failure.error).join("；"));
    }
    const documents = new Map(uploaded?.documents.map((item) => [item.client_ref, item.document]) ?? []);
    const parts = value.segments.flatMap((segment): ChatUIMessage["parts"][number][] => {
      if (segment.type === "text") return segment.text ? [{ type: "text", text: segment.text }] : [];
      const document = documents.get(segment.token.id);
      if (!document?.asset_id || !document.source_revision_id) return [];
      return [
        buildUserFilePart({
          conversationId,
          documentId: document.id,
          assetId: document.asset_id,
          revisionId: document.source_revision_id,
          filename: segment.token.label,
          mimeType: segment.token.mime ?? "application/octet-stream",
        }),
      ];
    });
    if (!parts.some((part) => part.type === "text")) {
      parts.push({ type: "text", text: "请阅读并处理我附加的文件。" });
    }
    return parts;
  }

  function changeLocation(next: "cloud" | "local") {
    if (next === "local" && promptRef.current?.getValue().tokens.length) {
      setError("本地新建会话暂不支持附件，请先移除附件再切换。");
      return;
    }
    setError(null);
    setLocation(next);
  }

  async function submit(value: PromptInputValue) {
    if (pending.current || (!value.text.trim() && value.tokens.length === 0)) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (location === "local") {
        if (!bridge) throw new Error("本地电脑需要桌面应用");
        if (!project) throw new Error("请先选择项目");
        const thread = await bridge.createThread(project, null, approvalMode);
        // Navigate even if inference fails: the local journal retains the request and error.
        try {
          await bridge.send(thread.id, value.text, randomId());
        } finally {
          void navigate(`/platform/chat/local/${thread.id}`);
        }
      } else {
        const conversation = await createConversation({ request_id: randomId() });
        const parts = await prepareCloudRequest(conversation.id, value);
        void navigate(`/platform/chat/conversations/${conversation.id}`, {
          state: { refreshConversationHistory: true, externalRequest: { id: randomId(), parts, mode } },
        });
      }
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-1 items-center justify-center px-6">
        <h1 className="text-2xl font-semibold">有什么可以帮你？</h1>
      </div>
      {error ? (
        <p role="alert" className="mx-auto w-full max-w-4xl px-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ChatPrompt
        ref={promptRef}
        placeholder={mode === "plan" && location === "cloud" ? "描述要规划的任务，@ 添加上下文" : "发送消息或创建任务…"}
        loading={busy}
        disabled={busy}
        maxFiles={location === "cloud" ? 8 : 0}
        maxFileSize={10 * 1024 * 1024}
        onError={setError}
        onSubmit={(value) => void submit(value)}
        toolbarRender={
          bridge
            ? () => (
                <NewConversationEnvironment
                  location={location}
                  onLocationChange={changeLocation}
                  projects={projects}
                  project={project}
                  onProjectChange={setProject}
                  onCreateProject={() => void createProject()}
                  disabled={busy}
                  selectingProject={selectingProject}
                />
              )
            : undefined
        }
        footerRender={() =>
          location === "cloud" ? (
            <>
              <ChatComposerControls
                agents={agents ?? []}
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
                mode={mode}
                onModeChange={setMode}
                disabled={busy}
              />
            </>
          ) : (
            <>
              <ChatComposerControls
                agents={[
                  {
                    id: localInference?.agentId ?? "local-default",
                    name: localInference?.agentName ?? "默认 Agent",
                  },
                ]}
                selectedAgentId={localInference?.agentId ?? "local-default"}
                mode="normal"
              />
              <ApprovalMode value={approvalMode} onChange={setApprovalMode} disabled={busy} />
            </>
          )
        }
      />
    </div>
  );
}
