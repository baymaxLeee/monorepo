import type { asset } from "@/domain";

export function latestAssetReview(reviews: readonly asset.AssetReview[] | undefined) {
  return reviews?.[reviews.length - 1];
}
