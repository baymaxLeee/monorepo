// Async boundary for Module Federation. See shell/src/main.tsx for rationale.
// Standalone-only entry. When loaded via shell, shell calls into ./App directly.
import("./bootstrap");
