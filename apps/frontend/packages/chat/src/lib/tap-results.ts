import type { TestResult, TestSuiteResult } from "@repo/ai-elements";

// Only a complete TAP 13 report is promoted to structured results. Partial,
// mixed, or unsupported output remains available verbatim in the terminal.
export function parseTapResults(stdout: string): TestSuiteResult[] | null {
  // Reject ordinary logs before allocating a normalized copy and a line array.
  if (!/^\s*TAP version 13(?:\r?\n|\s*$)/.test(stdout)) return null;
  const lines = stdout.replace(/\r\n/g, "\n").trim().split("\n");
  if (lines[0] !== "TAP version 13") return null;
  const tests: TestResult[] = [];
  let planned: number | undefined;
  for (const line of lines.slice(1)) {
    if (!line.trim() || /^\s|^#/.test(line)) continue;
    const plan = /^1\.\.(\d+)(?:\s+#.*)?$/.exec(line);
    if (plan) {
      if (planned !== undefined) return null;
      planned = Number(plan[1]);
      continue;
    }
    const result = /^(not ok|ok)\b(?:\s+(\d+))?(?:\s*-?\s*(.*))?$/.exec(line);
    if (!result) return null;
    const number = Number(result[2] ?? tests.length + 1);
    if (number !== tests.length + 1) return null;
    const name = result[3] || `测试 ${number}`;
    const skipped = /#\s*(SKIP|TODO)\b/i.test(name);
    tests.push({ id: String(number), name, status: skipped ? "skipped" : result[1] === "ok" ? "passed" : "failed" });
  }
  if (planned === undefined || planned !== tests.length || !tests.length) return null;
  return [{ id: "tap", name: "TAP 测试报告", tests }];
}
