import { ChatPrompt, type ApprovalPolicyValue, type PermissionProfileValue } from "@repo/ai-elements/conversation";
import type { PromptInputValue } from "@repo/ai-elements/prompt-input";
import { listProviders, type ModelProvider } from "@repo/api/admin";
import { createConversation, type ReasoningEffort } from "@repo/api/chat";
import { getDesktopBridge } from "@repo/runtime/desktop";
import { getErrorMessage, randomId } from "@repo/shared";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { localPromptMessageParts } from "../local/local-user-message";
import { DesktopNewConversationPrompt } from "./DesktopNewConversationPrompt";
import { NewConversationEndControls, NewConversationStartControls } from "./NewConversationControls";
import { localProjectLabel, NewConversationHero } from "./NewConversationHero";
import { prepareCloudConversationRequest } from "./prepare-cloud-request";
import { useDesktopProjects } from "./useDesktopProjects";

export function ConversationListPage() {
  const bridge = getDesktopBridge();
  const navigate = useNavigate();
  const [location, setLocation] = useState<"cloud" | "local">(() => (bridge ? "local" : "cloud"));
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicyValue>("on-request");
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfileValue>(":workspace");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const cloudDraft = useRef<{ settings: string; requestId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelProvider[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [localAvailable, setLocalAvailable] = useState<boolean | null>(() => (bridge ? null : false));
  const { projects, project, setProject, selectingProject, createProject } = useDesktopProjects(
    localAvailable === true ? bridge : null,
    setError,
  );

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge
      .info()
      .then((info) => {
        if (cancelled) return;
        setLocalAvailable(info.localAvailable);
        if (!info.localAvailable) setLocation("cloud");
      })
      .catch((cause) => {
        if (cancelled) return;
        setLocalAvailable(false);
        setLocation("cloud");
        setError(getErrorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

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

  async function submit(value: PromptInputValue) {
    if (pending.current || (!value.text.trim() && value.tokens.length === 0)) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!selectedModelId) throw new Error("请选择推理模型");
      if (location === "local") {
        if (!bridge) throw new Error("本地会话需要桌面应用");
        if (localAvailable !== true) throw new Error("本地执行环境不可用");
        if (!project) throw new Error("请先选择项目");
        const thread = await bridge.createThread(
          project,
          selectedModelId,
          reasoningEffort,
          approvalPolicy,
          permissionProfile,
          [],
        );
        try {
          const parts = await localPromptMessageParts(value, (file) => bridge.referenceFile(thread.id, file));
          await bridge.send(thread.id, parts, randomId());
        } catch (cause) {
          await bridge.removeThread(thread.id).catch(() => {});
          throw cause;
        }
        void navigate(`/platform/chat/local/${thread.id}`);
        return;
      }
      const settings = JSON.stringify([selectedModelId, reasoningEffort, approvalPolicy, permissionProfile]);
      if (cloudDraft.current?.settings !== settings) cloudDraft.current = { settings, requestId: randomId() };
      const conversation = await createConversation({
        request_id: cloudDraft.current.requestId,
        provider_id: selectedModelId,
        reasoning_effort: reasoningEffort,
        approval_policy: approvalPolicy,
        permission_profile: permissionProfile,
        plugin_selections: [],
      });
      const parts = await prepareCloudConversationRequest({
        conversationId: conversation.id,
        value,
      });
      cloudDraft.current = null;
      void navigate(`/platform/chat/conversations/${conversation.id}`, {
        state: { refreshConversationHistory: true, externalRequest: { id: randomId(), parts } },
      });
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const footerControls = {
    footerStartRender: () => (
      <NewConversationStartControls
        approvalPolicy={approvalPolicy}
        permissionProfile={permissionProfile}
        onChange={(value) => {
          setApprovalPolicy(value.approvalPolicy);
          setPermissionProfile(value.permissionProfile);
        }}
        disabled={busy}
      />
    ),
    footerEndRender: () => (
      <NewConversationEndControls
        models={models}
        selectedModelId={selectedModelId}
        onSelectModel={setSelectedModelId}
        reasoningEffort={reasoningEffort}
        onReasoningChange={setReasoningEffort}
        disabled={busy}
      />
    ),
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <NewConversationHero
        desktop={Boolean(bridge)}
        target={location === "local" ? localProjectLabel(project) : "云端"}
      />
      {error ? (
        <p role="alert" className="mx-auto w-full max-w-4xl px-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {bridge ? (
        <DesktopNewConversationPrompt
          autoFocus
          placeholder="随心输入"
          loading={busy}
          disabled={false}
          maxFiles={8}
          maxFileSize={10 * 1024 * 1024}
          onError={setError}
          onSubmit={(value) => void submit(value)}
          location={location}
          onLocationChange={setLocation}
          localAvailable={localAvailable !== false}
          projects={projects}
          project={project}
          onProjectChange={setProject}
          onCreateProject={() => void createProject()}
          selectingProject={selectingProject}
          contextDisabled={busy}
          {...footerControls}
        />
      ) : (
        <ChatPrompt
          autoFocus
          placeholder="发送消息或创建任务…"
          loading={busy}
          disabled={false}
          maxFiles={8}
          maxFileSize={10 * 1024 * 1024}
          onError={setError}
          onSubmit={(value) => void submit(value)}
          {...footerControls}
        />
      )}
    </div>
  );
}
