/**
 * Eager-anchor for MF Tier-2 platform packages (host only).
 * UI (@packages/components) is bundled per MFE, not shared here.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _shared from "@packages/shared";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _runtime from "@packages/runtime";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _authClient from "@packages/auth-client";

void _shared;
void _runtime;
void _authClient;

export const __mf_anchors_loaded = true;
