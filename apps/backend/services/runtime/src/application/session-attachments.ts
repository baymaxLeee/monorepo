import { createHash } from "node:crypto";

import { InnerApiError } from "@backend/inner-api/client";
import { UploadSessionState } from "@backend/inner-api/gen/storage/v1/storage";

import { storageClient } from "../infrastructure/clients/storage.js";
import { ConflictError, NotFoundError, RequestError } from "./errors.js";
import { publishSessionFile } from "./session-files.js";
import { getSessionRow } from "./sessions.js";
import { ATTACHMENT_ROOT, isValidWorkspacePath } from "./workspace-paths.js";

const attachmentIntentNamespace = "session-attachment";

function attachmentStorageError(error: unknown): never {
  if (error instanceof InnerApiError) {
    if (error.code === 3) throw new RequestError(error.message);
    if (error.code === 5 || error.code === 7) throw new NotFoundError("attachment upload not found");
    if (error.code === 6 || error.code === 9) throw new ConflictError(error.message);
  }
  throw error;
}

function intentId(sessionId: string, clientRef: string) {
  return createHash("sha256")
    .update(JSON.stringify([attachmentIntentNamespace, sessionId, clientRef]))
    .digest("hex");
}

export async function prepareSessionAttachment(
  sessionId: string,
  input: {
    client_ref: string;
    filename: string;
    media_type: string;
    size_bytes: number;
  },
) {
  await getSessionRow(sessionId);
  const filename = input.filename.normalize("NFC").trim();
  if (filename.includes("/") || !isValidWorkspacePath(ATTACHMENT_ROOT + filename))
    throw new RequestError("invalid attachment filename");
  const upload = await storageClient()
    .createUploadSession({
      intentId: intentId(sessionId, input.client_ref),
      filename,
      mediaType: input.media_type,
      sizeBytes: input.size_bytes,
    })
    .catch(attachmentStorageError);
  return {
    upload_id: upload.uploadSessionId,
    upload_url: upload.uploadUrl,
    completed: upload.state === UploadSessionState.UPLOAD_SESSION_STATE_COMPLETED,
  };
}

export async function completeSessionAttachment(
  sessionId: string,
  input: {
    client_ref: string;
    upload_id: string;
  },
) {
  await getSessionRow(sessionId);
  const storage = storageClient();
  const key = intentId(sessionId, input.client_ref);
  const upload = await storage
    .describeUploadSession({ uploadSessionId: input.upload_id })
    .catch(attachmentStorageError);
  if (upload.intentId !== key) {
    throw new NotFoundError("attachment upload does not belong to this session");
  }
  if (upload.state !== UploadSessionState.UPLOAD_SESSION_STATE_COMPLETED || !upload.assetId || !upload.revisionId) {
    throw new ConflictError("attachment upload is incomplete");
  }
  const revision = await storage
    .describeRevision({ assetId: upload.assetId, revisionId: upload.revisionId })
    .catch(attachmentStorageError);
  return publishSessionFile({
    sessionId,
    ...revision,
    title: revision.filename,
    workspacePath: ATTACHMENT_ROOT + upload.uploadSessionId + "/" + upload.filename,
    writerType: "user",
    writerId: key,
    idempotencyKey: key,
  });
}
