/**
 * Host eager shared anchors.
 *
 * Every package marked `eager: true` in `mf-shared.mjs` must be statically
 * reachable from the platform entry. These imports make the host register
 * core shared factories before any lazy route consumes them.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _shared from "@packages/shared";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _runtime from "@packages/runtime";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _observability from "@packages/observability";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _zustand from "zustand";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _zustandMiddleware from "zustand/middleware";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _zustandReactShallow from "zustand/react/shallow";

void _shared;
void _runtime;
void _observability;
void _zustand;
void _zustandMiddleware;
void _zustandReactShallow;

export const __mf_eager_anchors_loaded = true;
