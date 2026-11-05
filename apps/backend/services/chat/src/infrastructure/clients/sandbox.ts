import { propagationHeaders } from "@backend/kernel-ts";
import { SandboxInternalClient } from "@backend/transport-ts";

import { getSettings } from "../../bootstrap/config.js";

export function sandboxClient() {
  const settings = getSettings();
  return new SandboxInternalClient({
    baseUrl: settings.sandboxServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "chat",
    propagatedHeaders: propagationHeaders,
  });
}
