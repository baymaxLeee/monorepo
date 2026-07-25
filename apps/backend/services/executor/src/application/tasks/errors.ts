import { TransportError } from "@backend/transport-ts";
import { FatalError } from "workflow";

export function rethrowTerminalArtifactError(error: unknown): never {
  const body = error instanceof TransportError ? error.body : undefined;
  if (
    error instanceof TransportError &&
    error.service === "knowledge" &&
    error.status === 409 &&
    typeof body === "object" &&
    body !== null &&
    "code" in body &&
    body.code === "conversation_deleted"
  ) {
    throw new FatalError("conversation was deleted; artifact generation stopped");
  }
  throw error;
}
