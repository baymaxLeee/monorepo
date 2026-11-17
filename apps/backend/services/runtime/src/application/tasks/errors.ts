import { FatalError } from "workflow";

import { TransportError } from "#runtime/transport";

export function rethrowTerminalArtifactError(error: unknown): never {
  const body = error instanceof TransportError ? error.body : undefined;
  if (
    error instanceof TransportError &&
    error.service === "knowledge" &&
    error.status === 409 &&
    typeof body === "object" &&
    body !== null &&
    "code" in body &&
    body.code === "session_deleted"
  ) {
    throw new FatalError("session was deleted; artifact generation stopped");
  }
  throw error;
}
