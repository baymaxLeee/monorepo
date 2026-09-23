# ADR-0068: Contextual overlay layering

- Status: Accepted
- Date: 2026-09-23

## Context

Canvas had modal and popup constants for each screen depth and passed `popupZIndex` through reusable editors, configuration controls, and asset strips. This copied a visual infrastructure concern into domain components. It also failed compositionally: every new nested dialog required another pair of numbers, only selected popup primitives honored them, and changing content z-index could leave its overlay behind.

Base UI portals append DOM under `document.body` by default, but React context still follows the logical component tree across a portal. Ant Design and Arco Design expose a base modal/popup z-index, popup-container control, and contextual behavior for popup children. Material Design and Atlassian likewise model elevation as a small set of semantic layers.

## Decision

`@repo/design-system` owns overlay ordering. Modal content creates a React context containing its resolved modal and child-popup layers. Portalled popup primitives consume that context. A nested modal derives its layer from the nearest parent modal.

- modal baseline: 1000;
- modal overlay: modal - 1;
- child popup: modal + 50;
- nested modal: parent modal + 100.
- global toast viewport: 2147483647 (the CSS maximum, reserved by the design system).

The numbers are private implementation details. Business code expresses JSX ownership and nesting, not numeric layer topology. A modal's explicit numeric `style.zIndex` resets the complete scope so its backdrop and child popups remain synchronized. Popup `style.zIndex` and portal `container` remain narrow interoperability escape hatches for third-party surfaces and real DOM boundaries. The global toast viewport stays above modal scopes so feedback remains visible while a modal is open.

This mechanism is implemented on the shadcn Base Nova components backed by `@base-ui/react`. It covers Dialog, AlertDialog, Sheet, Drawer, ImagePreview, Select, Popover, DropdownMenu, Tooltip, ContextMenu, HoverCard, and Menubar. `Portal.container` remains independent from layer calculation, while popup positioning belongs to `Positioner`. New portalled primitives must join the same scope before use.

## Alternatives rejected

- A repository-wide list of named numeric tokens still requires callers to select and thread the correct depth, and grows with feature-specific nesting.
- DOM-order-only stacking is unstable when multiple primitive implementations and custom containers coexist.
- Always portalling into the nearest modal avoids some z-index work but introduces overflow clipping, positioning, focus, and stacking-context coupling. Container selection remains an independent layout decision.
- Retaining Radix beside Base UI was rejected because two equivalent primitive stacks duplicate accessibility behavior, composition APIs, dependencies, and agent decision paths. This repository has no legacy-compatibility requirement.
- Native top-layer migration is not used now because Base UI provides the required focus, dismissal, positioning, portal, and nested-composition contracts. It can replace the implementation later without changing the business-facing composition rule.

## Consequences

- Nested overlays work without business-level magic numbers or prop drilling.
- Overlay and content ordering is computed together.
- Third-party interoperability remains possible through explicit, documented overrides.
- Layer correctness depends on logical JSX ownership; independently mounted sibling modals need a product-level owner or an explicit boundary.
- The implementation and agent workflow are documented in the repository-root `DESIGN.md` and routed from the root and frontend `AGENTS.md` files.
