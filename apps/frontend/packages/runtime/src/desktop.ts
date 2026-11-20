import type { DesktopBridge } from "./generated/desktop";
export type {
  DesktopBridge,
  DesktopEvent,
  LocalDirectoryEntry,
  LocalFile,
  LocalUserMessagePart,
  LocalThread,
  LocalStream,
} from "./generated/desktop";

export function getDesktopBridge(): DesktopBridge | null {
  const bridge = (globalThis as typeof globalThis & { desktop?: DesktopBridge }).desktop;
  return bridge?.version === 6 ? bridge : null;
}
