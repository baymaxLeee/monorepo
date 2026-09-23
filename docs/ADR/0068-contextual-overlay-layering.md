# ADR-0068: Contextual overlay layering

- Status: Accepted
- Date: 2026-09-23

## Context

Canvas had modal and popup constants for each screen depth and passed `popupZIndex` through reusable editors, configuration controls, and asset strips. This copied a visual infrastructure concern into domain components. It also failed compositionally: every new nested dialog required another pair of numbers, only selected popup primitives honored them, and changing content z-index could leave its overlay behind.

Radix portals append DOM under `document.body`, but React context still follows the logical component tree across a portal. Ant Design and Arco Design expose a base modal/popup z-index, popup-container control, and contextual behavior for popup children. Material Design and Atlassian likewise model elevation as a small set of semantic layers.

## Decision

`@repo/design-system` owns overlay ordering. Modal content creates a React context containing its resolved modal and child-popup layers. Portalled popup primitives consume that context. A nested modal derives its layer from the nearest parent modal.

- modal baseline: 1000;
- modal overlay: modal - 1;
- child popup: modal + 50;
- nested modal: parent modal + 100.

The numbers are private implementation details. Business code expresses JSX ownership and nesting, not numeric layer topology. Modal `zIndex` and `popupZIndex`, popup `style.zIndex`, and portal `container` remain narrow interoperability escape hatches.

This mechanism covers Dialog, AlertDialog, Sheet, Drawer, ImagePreview, Select, Popover, DropdownMenu, Tooltip, ContextMenu, HoverCard, and Menubar. New portalled primitives must join the same scope before use.

## Alternatives rejected

- A repository-wide list of named numeric tokens still requires callers to select and thread the correct depth, and grows with feature-specific nesting.
- DOM-order-only stacking is unstable when multiple primitive implementations and custom containers coexist.
- Always portalling into the nearest modal avoids some z-index work but introduces overflow clipping, positioning, focus, and stacking-context coupling. Container selection remains an independent layout decision.
- Native top-layer migration is not used now because the current Radix primitives, dismissal behavior, and browser interaction contracts are already established. It can replace the implementation later without changing the business-facing composition rule.

## Consequences

- Nested overlays work without business-level magic numbers or prop drilling.
- Overlay and content ordering is computed together.
- Third-party interoperability remains possible through explicit, documented overrides.
- Layer correctness depends on logical JSX ownership; independently mounted sibling modals need a product-level owner or an explicit boundary.
- The implementation and agent workflow are documented in the repository-root `DESIGN.md` and routed from the root and frontend `AGENTS.md` files.
