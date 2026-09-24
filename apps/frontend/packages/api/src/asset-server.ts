import { getAssetServerAPI, type UploadResult } from "../generated/asset-server/index";

export interface AssetRevisionRef {
  assetId: string;
  revisionId: string;
}

export type UploadedAssetRevision = AssetRevisionRef & {
  filename: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  url: string;
};

export const AssetCategory = {
  CANVAS_COVER: "canvas-cover",
  CANVAS_SOURCE: "canvas-source",
  KNOWLEDGE_SOURCE: "knowledge-source",
  SKILL_ARCHIVE: "skill-archive",
  SKILL_ATTACHMENT: "skill-attachment",
} as const;

export type AssetCategory = (typeof AssetCategory)[keyof typeof AssetCategory];

const { assetUpload } = getAssetServerAPI();

function presentUpload(result: UploadResult): UploadedAssetRevision {
  return {
    assetId: result.asset_id,
    revisionId: result.revision_id,
    filename: result.filename,
    mediaType: result.media_type,
    sizeBytes: result.size_bytes,
    sha256: result.sha256,
    url: result.url,
  };
}

/** Upload one file as a new immutable platform Asset revision. */
export async function uploadAssetRevision(
  file: File,
  category: string,
  signal?: AbortSignal,
): Promise<UploadedAssetRevision> {
  return presentUpload(await assetUpload({ file }, { category }, { signal }));
}
