import type { ProjectUsageDetail } from "@/api";
import type { project } from "@/domain";

export interface ProjectTableItem extends project.ProjectSummary {
  MemberUserIDs: string[];
}

export interface ProjectFormValues {
  Name: string;
  MemberUserIDs: string[];
  CoverImage?: { assetId: string; revisionId: string };
  UsageLimit?: number;
}

export type ProjectDialogState =
  | { mode: "create"; project?: undefined }
  | {
      mode: "edit";
      project: ProjectUsageDetail | project.MemberProjectDetail;
    };
