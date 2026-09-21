import type { asset } from "@/domain";

import type { AgentFrameService } from "./agentframe";

export async function listAvailableBenefitPackages(
  service: Pick<AgentFrameService, "ListAvailableBenefitPackages">,
  projectId: string,
) {
  const response = await service.ListAvailableBenefitPackages({
    ProjectID: projectId,
  });
  return response.Items;
}

export async function batchSubmitAssetReviews(
  service: Pick<AgentFrameService, "BatchSubmitAssetReviews">,
  projectId: string,
  submissions: Array<{
    packageId: string;
    source: Pick<asset.SubmitAssetReviewRequest, "AssetID" | "Upload">;
  }>,
) {
  const response = await service.BatchSubmitAssetReviews({
    ProjectID: projectId,
    Items: submissions.map(({ packageId, source }) => ({
      PackageID: packageId,
      ...source,
    })),
  });
  return response.Items;
}

export async function batchGetAssetReviews(
  service: Pick<AgentFrameService, "BatchGetAssetReviews">,
  projectId: string,
  assetIds: string[],
  requestConfig?: Parameters<AgentFrameService["BatchGetAssetReviews"]>[1],
) {
  const request = {
    ProjectID: projectId,
    AssetIDs: assetIds,
  };
  const response = requestConfig
    ? await service.BatchGetAssetReviews(request, requestConfig)
    : await service.BatchGetAssetReviews(request);
  return response.Items;
}
