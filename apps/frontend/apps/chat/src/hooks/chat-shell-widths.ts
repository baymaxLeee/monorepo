const LEFT_DEFAULT_FRACTION = 0.15;
const LEFT_MAX_FRACTION = 0.2;
const RIGHT_DEFAULT_FRACTION = 0.4;
const RIGHT_MAX_FRACTION = 0.8;
const COLLAPSE_FRACTION = 0.1;
const MIN_MAIN_FRACTION = 0.25;
const MIN_MAIN_WIDTH_PX = 320;
const COMPACT_BREAKPOINT = 640;

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function panelLimits(containerWidth: number) {
  const w = containerWidth;
  return {
    leftDefault: w * LEFT_DEFAULT_FRACTION,
    leftMax: w * LEFT_MAX_FRACTION,
    leftCollapse: w * COLLAPSE_FRACTION,
    rightDefault: w * RIGHT_DEFAULT_FRACTION,
    rightMax: w * RIGHT_MAX_FRACTION,
    rightCollapse: w * COLLAPSE_FRACTION,
    minMain: Math.max(w * MIN_MAIN_FRACTION, MIN_MAIN_WIDTH_PX),
  };
}

export function readStoredWidth(key: string): number | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw === "") {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function persistWidth(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {}
}

export function resolvePanelWidth(stored: number | null, fallback: number, collapse: number, max: number) {
  const preferred = stored ?? fallback;
  return clamp(preferred, collapse, Math.max(collapse, max));
}

export function isCompactLayout(width: number, artifactOpen: boolean) {
  const limits = panelLimits(width);
  return (
    width > 0 &&
    width < (artifactOpen ? limits.minMain + limits.leftCollapse + limits.rightCollapse : COMPACT_BREAKPOINT)
  );
}
