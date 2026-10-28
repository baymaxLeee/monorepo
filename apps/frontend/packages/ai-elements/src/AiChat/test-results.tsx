import { CodeBlock, CodeBlockContent } from "@repo/design-system/shadcn/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@repo/design-system/shadcn/trace";
import { CheckCircleIcon, CircleIcon, FlaskConicalIcon, XCircleIcon } from "lucide-react";
import type { ComponentProps } from "react";

export interface TestResult {
  id: string;
  name: string;
  status: "passed" | "failed" | "skipped" | "running";
  durationMs?: number;
  error?: string;
}
export interface TestSuiteResult {
  id: string;
  name: string;
  tests: TestResult[];
}
export type TestResultsProps = ComponentProps<"div"> & { suites: TestSuiteResult[]; isRunning?: boolean };
export function TestResults({ suites, isRunning = false, ...props }: TestResultsProps) {
  const tests = suites.flatMap((suite) => suite.tests);
  const failed = tests.filter((test) => test.status === "failed").length;
  const passed = tests.filter((test) => test.status === "passed").length;
  return (
    <Trace {...props}>
      <TraceCollapsible defaultOpen={failed > 0}>
        <TraceCollapsibleTrigger>
          <TraceLine status={isRunning ? "running" : failed ? "error" : undefined}>
            <TraceIcon>
              <FlaskConicalIcon />
            </TraceIcon>
            <TraceTitle>{isRunning ? "测试运行中" : `${passed} 项通过，${failed} 项失败`}</TraceTitle>
            <TraceDescription>共 {tests.length} 项</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            {suites.map((suite) => (
              <TestSuite key={suite.id} suite={suite} />
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
export function TestSuite({ suite }: { suite: TestSuiteResult }) {
  const failed = suite.tests.some((test) => test.status === "failed");
  return (
    <TraceCollapsible defaultOpen={failed}>
      <TraceCollapsibleTrigger>
        <TraceLine status={failed ? "error" : undefined}>
          <TraceTitle>{suite.name}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>
          {suite.tests.map((test) => (
            <Test key={test.id} result={test} />
          ))}
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
export function Test({ result }: { result: TestResult }) {
  return (
    <div className="space-y-2">
      <TraceLine status={result.status === "failed" ? "error" : result.status === "running" ? "running" : undefined}>
        <TraceIcon>
          {result.status === "passed" ? (
            <CheckCircleIcon />
          ) : result.status === "failed" ? (
            <XCircleIcon />
          ) : (
            <CircleIcon />
          )}
        </TraceIcon>
        <TraceTitle>{result.name}</TraceTitle>
        <span className="sr-only">{result.status}</span>
        {result.durationMs !== undefined ? <TraceDescription>{result.durationMs} ms</TraceDescription> : null}
      </TraceLine>
      {result.error ? (
        <CodeBlock size="sm" variant="destructive">
          <CodeBlockContent wrap className="max-h-64">
            {result.error}
          </CodeBlockContent>
        </CodeBlock>
      ) : null}
    </div>
  );
}
