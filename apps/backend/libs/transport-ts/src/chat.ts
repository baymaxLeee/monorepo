import { InternalHttpClient } from "./http.js";

export interface TaskProgress {
  done: number;
  total: number;
}

// Reverse-direction notification: executor -> chat. Chat owns the durable task
// (write_file/edit_file dispatched it), so it is the one that pushes live
// progress + terminal state to the browser over its resumable stream. Executor
// only fires these; it does not know how chat delivers them.
export interface TaskEventNotification {
  taskId: string;
  conversationId: string;
  ownerRef: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress?: TaskProgress | null;
  result?: unknown;
  error?: string | null;
}

export interface ChatClientOptions {
  baseUrl: string;
  internalToken: string;
  timeoutMs?: number;
}

export class ChatInternalClient {
  private readonly http: InternalHttpClient;

  constructor(options: ChatClientOptions) {
    this.http = new InternalHttpClient({ ...options, service: "chat" });
  }

  async notifyTaskEvent(input: TaskEventNotification): Promise<void> {
    await this.http.requestJson({
      method: "POST",
      path: "/internal/tasks/notify",
      body: input,
    });
  }
}
