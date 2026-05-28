/**
 * Host eager shared anchors.
 *
 * Every package marked `eager: true` in `mf-shared.mjs` must be statically
 * reachable from the platform entry. These imports make the host register
 * core shared factories before any lazy route consumes them.
 *
 * `void _xxx` 强制保留 import，防止打包器 tree-shaking。
 */

import * as _observability from "observability";
import * as _runtime from "runtime";
import * as _shared from "shared";
import * as _zustand from "zustand";
import * as _zustandMiddleware from "zustand/middleware";
import * as _zustandReactShallow from "zustand/react/shallow";

void _shared;
void _runtime;
void _observability;
void _zustand;
void _zustandMiddleware;
void _zustandReactShallow;

export const __mf_eager_anchors_loaded = true;
