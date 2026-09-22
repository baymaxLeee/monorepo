import {
  canvasBatchGetAssetReviews,
  canvasBatchSubmitAssetReviews,
  CanvasBenefitPackageScopeType,
  canvasListAvailableBenefitPackages,
  type CanvasAssetReview,
} from "@repo/api";

import type { asset, benefit_package } from "@/domain";

function review(value: CanvasAssetReview): asset.AssetReview {
  return {
    FailureReason: value.failure_reason,
    PackageID: value.package_id,
    PackageName: value.package_name,
    Status: value.status,
    SubmittedAt: value.submitted_at,
    UpdatedAt: value.updated_at,
  };
}

export async function listAvailableBenefitPackages(): Promise<benefit_package.BenefitPackage[]> {
  const response = await canvasListAvailableBenefitPackages();
  return response.items.map((item) => ({
    PackageID: item.package_id,
    IsPreset: item.is_preset,
    Name: item.name,
    ProjectName: item.project_name,
    HasAccessKeyID: item.has_access_key_id,
    HasSecretAccessKey: item.has_secret_access_key,
    Enabled: item.enabled,
    ModelIDs: item.model_ids,
    MaterialUsed: item.material_used,
    Revision: item.revision,
    CreatedBy: item.created_by,
    UpdatedBy: item.updated_by,
    CreatedAt: item.created_at,
    UpdatedAt: item.updated_at,
    ScopeType: item.is_preset
      ? CanvasBenefitPackageScopeType.SYSTEM_PRESET_MODELS
      : CanvasBenefitPackageScopeType.CUSTOM_MODELS,
  }));
}

export async function batchSubmitAssetReviews(
  projectId: string,
  submissions: Array<{ packageId: string; source: Pick<asset.SubmitAssetReviewRequest, "AssetID" | "Upload"> }>,
) {
  const response = await canvasBatchSubmitAssetReviews(projectId, {
    items: submissions.map(({ packageId, source }) => ({
      package_id: packageId,
      asset_id: source.AssetID,
      upload: source.Upload
        ? { blob_id: source.Upload.BlobID, client_id: source.Upload.ClientID, file_name: source.Upload.FileName }
        : undefined,
    })),
  });
  return response.items.map((item) => ({
    AssetID: item.asset_id,
    PackageID: item.package_id,
    Review: item.review ? review(item.review) : undefined,
    ErrorCode: item.error_code,
    ErrorMessage: item.error_message,
  }));
}

export async function batchGetAssetReviews(projectId: string, assetIds: string[], signal?: AbortSignal) {
  const response = await canvasBatchGetAssetReviews(projectId, { asset_ids: assetIds }, { signal });
  return response.items.map((item) => ({ AssetID: item.asset_id, Reviews: item.reviews.map(review) }));
}
