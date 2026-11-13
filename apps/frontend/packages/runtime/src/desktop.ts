import type { DesktopBridge } from "./generated/desktop";
export type {
  DesktopBridge,
  DesktopEvent,
  LocalDirectoryEntry,
  LocalFile,
  LocalThread,
  LocalStream,
} from "./generated/desktop";

export function getDesktopBridge(): DesktopBridge | null {
  const bridge = (globalThis as typeof globalThis & { desktop?: DesktopBridge }).desktop;
  return bridge?.version === 1 ? bridge : null;
}
