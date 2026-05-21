// Async boundary for Module Federation. See platform/src/main.tsx for rationale.
// Standalone-only entry. When loaded via platform, platform calls into ./App directly.
import("./bootstrap");
