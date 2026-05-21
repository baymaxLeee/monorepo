/**
 * Eager-anchor file for Module Federation shared deps.
 *
 * Why this file exists
 * --------------------
 * The shared-deps registry (`apps/frontend/mf-shared.ts`) marks platform
 * workspace packages (`@app/ui-kit`, `@app/runtime`, ...) as `eager: true` on
 * the host so they are bundled into shell's initial chunk and registered into
 * the MF share-scope synchronously at startup. Subsequent MFEs then *reuse*
 * the host's copies instead of bundling their own.
 *
 * Tree-shaking caveat
 * -------------------
 * `eager: true` only keeps a dep in the initial chunk if **the host source
 * statically reaches it**. shell currently has no business need to import
 * `@app/runtime` etc. directly, so without this anchor file the dead-code
 * eliminator drops them and `eager` becomes a lie at runtime → "factory is
 * undefined" error in MFEs that try to consume them.
 *
 * Side-effect imports below force these packages into shell's main bundle.
 * Re-export `__anchor` (or just keep the imports) so tree-shaker can't argue
 * the file is unused.
 *
 * Adding a new shared workspace package
 *   1. Add it to TIER2 in `apps/frontend/mf-shared.ts`.
 *   2. Add a side-effect import here.
 *   3. Add it to shell's package.json deps if not already there.
 *   4. Restart `just dev`.
 */

// Side-effect imports — these force the workspace packages into shell's bundle
// so the eager registration in MF share-scope is real, not phantom.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _shared from "@app/shared";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _runtime from "@app/runtime";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _designTokens from "@app/design-tokens";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _authClient from "@app/auth-client";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _uiKit from "@app/ui-kit";

// Touch each namespace so neither rspack's optimizer nor swc dares drop them.
// `void` keeps the expression side-effecting without producing a value.
void _shared;
void _runtime;
void _designTokens;
void _authClient;
void _uiKit;

export const __mf_anchors_loaded = true;
