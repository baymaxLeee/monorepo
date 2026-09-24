import { authFetch } from "./auth-fetch";

export interface AssetRevisionRef {
  assetId: string;
  revisionId: string;
}

export interface AssetUploadPlan {
  uploadSessionId: string;
  intentId: string;
  state: "pending" | "uploading" | "completed" | "failed" | "aborted";
  uploadUrl: string;
  expiresAt: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  assetId?: string | null;
  revisionId?: string | null;
}

/** Execute a server-authorized byte transfer without choosing storage policy in the browser. */
export async function executeAssetUploadPlan(plan: AssetUploadPlan, file: File, signal?: AbortSignal): Promise<void> {
  if (plan.state === "completed") return;
  if (plan.state === "aborted") throw new Error("upload session has expired");
  if (file.name !== plan.filename || file.size !== plan.sizeBytes) {
    throw new Error("selected file no longer matches the authorized upload plan");
  }
  const response = await authFetch(plan.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": plan.mediaType },
    body: file,
    signal,
  });
  if (!response.ok) {
    throw new Error(`asset upload failed: ${response.status}`);
  }
}
