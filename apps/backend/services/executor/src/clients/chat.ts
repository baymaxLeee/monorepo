import { ChatInternalClient, type TaskEventNotification } from "@backend/transport-ts";

import { getSettings } from "../config.js";

export type { TaskEventNotification } from "@backend/transport-ts";

function chatClient(): ChatInternalClient {
  const s = getSettings();
  return new ChatInternalClient({
    baseUrl: s.chatServiceUrl,
    internalToken: s.internalApiToken,
  });
}

export async function notifyTaskEvent(input: TaskEventNotification): Promise<void> {
  await chatClient().notifyTaskEvent(input);
}
