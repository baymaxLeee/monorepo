/**
 * Eager-anchor for workspace MF shared packages (host only).
 * Remotes consume these from the platform and do not bundle fallbacks.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _shared from "@packages/shared";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _runtime from "@packages/runtime";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _authClient from "@packages/auth-client";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _components from "@packages/components";

void _shared;
void _runtime;
void _authClient;
void _components;

export const __mf_anchors_loaded = true;
