import {
  ExecutionPolicy,
  ChatComposerControls,
  ChatPrompt,
  NewConversationEnvironment,
  type ApprovalPolicyValue,
  type PermissionProfileValue,
  type ChatUIMessage,
} from "@repo/ai-elements/conversation";
import { buildUserFilePart } from "@repo/ai-elements/conversation/lib/file-parts";
import { uploadConversationFiles } from "@repo/ai-elements/conversation/lib/upload-conversation-files";
import type { PromptInputRef, PromptInputValue } from "@repo/ai-elements/prompt-input";
import {
  listAgentPluginOptions,
  listProviders,
  type AgentPluginSelectionOption,
  type ModelProvider,
} from "@repo/api/admin";
import { createConversation, type ReasoningEffort } from "@repo/api/chat";
import { getDesktopBridge } from "@repo/runtime/desktop";
import { getErrorMessage, randomId } from "@repo/shared";
import { BotIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { PluginPicker } from "./PluginPicker";

export function ConversationListPage() {
  const bridge = getDesktopBridge();
  const navigate = useNavigate();
  const [location, setLocation] = useState<"cloud" | "local">(() => (bridge ? "local" : "cloud"));
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [selectingProject, setSelectingProject] = useState(false);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicyValue>("on-request");
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfileValue>(":workspace");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const promptRef = useRef<PromptInputRef>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelProvider[]>([]);
  const [plugins, setPlugins] = useState<AgentPluginSelectionOption[]>([]);
  const [selectedPluginIds, setSelectedPluginIds] = useState<string[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");

  useEffect(() => {
    const controller = new AbortController();
    void listProviders({ signal: controller.signal, skipErrorNotify: true })
      .then((providers) => {
        const chatModels = providers.filter((provider) => provider.provider_kind === "chat" && provider.is_enabled);
        setModels(chatModels);
        setSelectedModelId((current) =>
          chatModels.some((provider) => provider.id === current)
            ? current
            : (chatModels.find((provider) => provider.is_default)?.id ?? chatModels[0]?.id ?? null),
        );
      })
      .catch(() => setModels([]));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void listAgentPluginOptions({ signal: controller.signal, skipErrorNotify: true })
      .then((items) => {
        setPlugins(items);
        setSelectedPluginIds(
          items
            .filter((plugin) => plugin.selectedByDefault)
            .map((plugin) => plugin.pluginId)
            .sort(),
        );
      })
      .catch(() => setPlugins([]));
    return () => controller.abort();
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
            providerId: selectedModelId ?? undefined,
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
        if (!selectedModelId) throw new Error("请选择推理模型");
        const thread = await bridge.createThread(
          project,
          selectedModelId,
          reasoningEffort,
          approvalPolicy,
          permissionProfile,
          selectedPluginIds.map((pluginId) => ({ pluginId })),
        );
        // Navigate even if inference fails: the local journal retains the request and error.
        try {
          await bridge.send(thread.id, value.text, randomId());
        } finally {
          void navigate(`/platform/chat/local/${thread.id}`);
        }
      } else {
        if (!selectedModelId) throw new Error("请选择推理模型");
        const conversation = await createConversation({
          request_id: randomId(),
          provider_id: selectedModelId,
          reasoning_effort: reasoningEffort,
          plugin_selections: selectedPluginIds.map((plugin_id) => ({ plugin_id })),
        });
        const parts = await prepareCloudRequest(conversation.id, value);
        void navigate(`/platform/chat/conversations/${conversation.id}`, {
          state: { refreshConversationHistory: true, externalRequest: { id: randomId(), parts } },
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
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl border bg-card text-muted-foreground shadow-sm">
          <BotIcon className="size-6" aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">有什么可以帮你？</h1>
      </div>
      {error ? (
        <p role="alert" className="mx-auto w-full max-w-4xl px-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ChatPrompt
        ref={promptRef}
        autoFocus
        placeholder="发送消息或创建任务…"
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
                models={models}
                selectedModelId={selectedModelId}
                onSelectModel={setSelectedModelId}
                reasoningEffort={reasoningEffort}
                onReasoningEffortChange={setReasoningEffort}
                disabled={busy}
              />
              <PluginPicker
                plugins={plugins}
                selected={selectedPluginIds}
                onChange={setSelectedPluginIds}
                disabled={busy}
              />
            </>
          ) : (
            <>
              <ChatComposerControls
                models={models}
                selectedModelId={selectedModelId}
                onSelectModel={setSelectedModelId}
                reasoningEffort={reasoningEffort}
                onReasoningEffortChange={setReasoningEffort}
                disabled={busy}
              />
              <PluginPicker
                plugins={plugins}
                selected={selectedPluginIds}
                onChange={setSelectedPluginIds}
                disabled={busy}
              />
              <ExecutionPolicy
                approvalPolicy={approvalPolicy}
                permissionProfile={permissionProfile}
                onChange={(value) => {
                  setApprovalPolicy(value.approvalPolicy);
                  setPermissionProfile(value.permissionProfile);
                }}
                disabled={busy}
              />
            </>
          )
        }
      />
    </div>
  );
}
