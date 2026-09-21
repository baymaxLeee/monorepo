import type { project } from "@/domain";

import { agentframeService } from "./agentframe";

const PROJECT_MODEL_PAGE_SIZE = 100;

type GrantedProjectModelFilter = Omit<project.ProjectModelFilter, "IsGranted">;

export async function listGrantedProjectModels(
  projectId: string,
  filter: GrantedProjectModelFilter = {},
): Promise<project.ProjectModelInfo[]> {
  const models: project.ProjectModelInfo[] = [];
  let pageNumber = 1;

  for (;;) {
    const response = await agentframeService.ListProjectModels({
      ProjectID: projectId,
      ListOpt: { PageNumber: pageNumber, PageSize: PROJECT_MODEL_PAGE_SIZE },
      Filter: { ...filter, IsGranted: true },
    });
    models.push(...response.Items);
    if (models.length >= response.Total || response.Items.length === 0) {
      return models;
    }
    pageNumber += 1;
  }
}

export async function listGrantedProjectModelDetails(
  projectId: string,
  filter: GrantedProjectModelFilter = {},
): Promise<project.ProjectModelInfo[]> {
  return listGrantedProjectModels(projectId, filter);
}
