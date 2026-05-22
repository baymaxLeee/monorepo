/**
 * Eager-anchor for workspace MF shared packages (host only).
 * Remotes consume these from the platform and do not bundle fallbacks.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _shared from "@packages/shared";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _runtime from "@packages/runtime";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _api from "@packages/api";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _components from "@packages/components";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _zustandReactShallow from "zustand/react/shallow";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _zustandShallow from "zustand/shallow";

void _shared;
void _runtime;
void _api;
void _components;
void _zustandReactShallow;
void _zustandShallow;

export const __mf_anchors_loaded = true;
