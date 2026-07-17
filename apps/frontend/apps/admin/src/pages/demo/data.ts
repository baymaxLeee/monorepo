export const demoTabs = [
  "basic",
  "form",
  "overlay",
  "data",
  "code-editor",
  "file-workspace",
  "markdown-editor",
  "pdf-previewer",
  "xmind-previewer",
] as const;

export type DemoTab = (typeof demoTabs)[number];

export const defaultDemoTab: DemoTab = "basic";

export function resolveDemoTab(value: string | null): DemoTab {
  return demoTabs.includes(value as DemoTab)
    ? (value as DemoTab)
    : defaultDemoTab;
}
