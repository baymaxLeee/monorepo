import { AdminInternalClient } from "@backend/transport-ts";

import type { CanvasVideoInput as Input } from "../../../workflows/canvas-video-generation.js";
import { getSettings } from "../../bootstrap/config.js";
import { deleteArkVideoTask } from "../../infrastructure/clients/ark.js";
import type { TaskProgress } from "../tasks/types.js";

export async function providerFor(input: Input) {
  const settings = getSettings();
  const client = new AdminInternalClient({
    baseUrl: settings.adminServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "executor",
  });
  const provider = await client.getProvider(input.providerId, input.tenantId, input.workspaceId);
  if (provider.provider_kind !== "video" || !provider.is_enabled)
    throw new Error("An enabled video provider is required");
  return {
    baseUrl: provider.base_url,
    apiKey: provider.api_key,
    model: provider.model,
    extraBody: provider.extra_body ?? {},
  };
}

export async function cancelCanvasVideo(input: Input, progress: TaskProgress | null) {
  if (!progress?.externalTaskIds?.length) return;
  const provider = await providerFor(input);
  await Promise.all(
    progress.externalTaskIds.map((taskId) =>
      deleteArkVideoTask({ ...provider, taskId, signal: AbortSignal.timeout(30_000) }),
    ),
  );
}
