import { propagationHeaders } from "@backend/kernel-ts";
import { TransportError } from "@backend/transport-ts";
import { CanvasInternalClient } from "@backend/transport-ts/canvas";

import { AppError, ConflictError, NotFoundError, RequestError } from "../../application/errors.js";
import { getSettings } from "../../bootstrap/config.js";

function canvasError(error: unknown): never {
  if (error instanceof TransportError) {
    if (error.status === 404 || error.status === 403) throw new NotFoundError("Canvas is missing or inaccessible");
    if (error.status === 409) throw new ConflictError("Canvas changed; read the current graph before retrying");
    if (error.status === 400) throw new RequestError("Invalid canvas operation");
    throw new AppError("Canvas service is unavailable", 502, "canvas_unavailable");
  }
  throw error;
}

export function canvasClient() {
  const settings = getSettings();
  const client = new CanvasInternalClient({
    baseUrl: settings.canvasServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "chat",
    propagatedHeaders: propagationHeaders,
  });
  return {
    startGeneration: (...args: Parameters<CanvasInternalClient["startGeneration"]>) =>
      client.startGeneration(...args).catch(canvasError),
    listGenerations: (...args: Parameters<CanvasInternalClient["listGenerations"]>) =>
      client.listGenerations(...args).catch(canvasError),
    cancelGeneration: (...args: Parameters<CanvasInternalClient["cancelGeneration"]>) =>
      client.cancelGeneration(...args).catch(canvasError),
    graph: (...args: Parameters<CanvasInternalClient["graph"]>) => client.graph(...args).catch(canvasError),
    mutate: (...args: Parameters<CanvasInternalClient["mutate"]>) => client.mutate(...args).catch(canvasError),
  };
}
