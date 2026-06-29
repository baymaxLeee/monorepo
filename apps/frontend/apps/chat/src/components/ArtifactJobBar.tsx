import type { ArtifactJob } from "api";
import { Badge } from "components";
import { Loader2Icon } from "lucide-react";

function phaseLabel(job: ArtifactJob): string {
  if (job.status === "cancelled" || job.status === "cancel_requested") return "已取消";
  if (job.status === "failed") return "生成失败";
  if (job.status === "completed" && job.phase === "published") return "已完成";
  switch (job.phase) {
    case "reserved":
      return "排队中";
    case "generating_blocks":
      return "生成页面";
    case "compiling":
      return "编译中";
    case "publishing":
      return "发布中";
    case "published":
      return "已完成";
    default:
      return job.phase;
  }
}

function phaseVariant(job: ArtifactJob): "default" | "secondary" | "destructive" | "outline" {
  if (job.status === "failed") return "destructive";
  if (job.status === "cancelled" || job.status === "cancel_requested") return "outline";
  if (job.status === "completed") return "default";
  return "secondary";
}

function isActive(job: ArtifactJob): boolean {
  return ["queued", "running", "cancel_requested"].includes(job.status);
}

export function ArtifactJobBar({ jobs }: { jobs: ArtifactJob[] }) {
  const activeJobs = jobs.filter(isActive);
  if (!activeJobs.length) return null;

  return (
    <div className="mb-2 space-y-2">
      {activeJobs.map((job) => (
        <div
          key={job.id}
          className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        >
          <Badge variant={phaseVariant(job)}>{phaseLabel(job)}</Badge>
          {isActive(job) ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
          <span className="font-medium text-foreground">Artifact 任务</span>
          <span>
            {job.completed_blocks}/{job.total_blocks || "?"}
            {job.failed_blocks > 0 ? ` · ${job.failed_blocks} 失败` : ""}
          </span>
          {job.attempt > 1 ? <span>第 {job.attempt} 次尝试</span> : null}
          {job.error ? <span className="text-destructive">{job.error}</span> : null}
        </div>
      ))}
    </div>
  );
}
