import { ShieldCheck as IconCompliancePlanarity } from "lucide-react";

import { Tooltip } from "@/components/ui";
import { asset as assetIDL } from "@/domain";
import t from "@/utils/i18n";

import type { AssetMentionItem } from "./types";

type ShieldTone = "muted" | "processing" | "approved" | "failed";

const ICON_TONE_CLASSES: Record<Exclude<ShieldTone, "processing">, string> = {
  approved: "[&>path:first-child]:fill-[#369AFE]",
  failed: "[&>path:first-child]:fill-[#BD7E00]",
  muted: "[&>path:first-child]:fill-[#C7CCD6]",
};

export function ReviewShield({ tone }: { tone: ShieldTone }) {
  if (tone === "processing") {
    return (
      <span
        aria-hidden
        className="box-border h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-solid border-primary border-r-[transparent]"
      />
    );
  }
  return (
    <IconCompliancePlanarity aria-hidden className={`shrink-0 ${ICON_TONE_CLASSES[tone]}`} height="14" width="14" />
  );
}

function ReviewActionArrow() {
  return (
    <svg aria-hidden fill="none" height={14} viewBox="0 0 14 14" width={14}>
      <path
        clipRule="evenodd"
        d="M8.633 9.749a.583.583 0 0 1-.007-.825l1.924-1.955-1.917-1.886a.583.583 0 1 1 .818-.832l2.225 2.189a.742.742 0 0 1 .009 1.039L9.457 9.742a.583.583 0 0 1-.824.007ZM2.042 7c0-.322.261-.583.583-.583h7.92a.583.583 0 1 1 0 1.166h-7.92A.583.583 0 0 1 2.042 7Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

function reviewTone(review?: assetIDL.AssetReview): ShieldTone {
  if (!review) return "muted";
  if (review.Status === assetIDL.AssetReviewStatus.APPROVED) return "approved";
  if (review.Status === assetIDL.AssetReviewStatus.FAILED) return "failed";
  return "processing";
}

export function reviewPackageName(review: assetIDL.AssetReview) {
  return review.PackageName;
}

export function assetReviewsForDisplay(asset: Pick<AssetMentionItem, "review" | "reviews">) {
  const reviews = [...(asset.reviews ?? []), ...(asset.review ? [asset.review] : [])];
  const packages = new Map<string, assetIDL.AssetReview>();
  reviews.forEach((review) => {
    packages.set(review.PackageID, review);
  });
  return [...packages.values()];
}

function approvedReviews(asset: Pick<AssetMentionItem, "review" | "reviews">) {
  return assetReviewsForDisplay(asset).filter((review) => review.Status === assetIDL.AssetReviewStatus.APPROVED);
}

export function reviewStatusText(review?: assetIDL.AssetReview) {
  switch (review?.Status) {
    case assetIDL.AssetReviewStatus.SUBMITTING:
      return t("提交中");
    case assetIDL.AssetReviewStatus.PROCESSING:
      return t("审核中");
    case assetIDL.AssetReviewStatus.APPROVED:
      return t("审核通过");
    case assetIDL.AssetReviewStatus.FAILED:
      return t("审核失败");
    default:
      return "";
  }
}

export function renderAssetReviewTooltipContent({
  review,
  reviews,
}: {
  review?: assetIDL.AssetReview;
  reviews?: assetIDL.AssetReview[];
}) {
  const packages = assetReviewsForDisplay({ review, reviews });
  const current = review ?? packages.at(-1);
  if (!current) return null;

  return (
    <div
      className="grid gap-x-3 text-[12px] leading-5 text-white"
      style={{ gridTemplateColumns: "auto minmax(0, 155px)" }}
    >
      <span>{t("审核状态")}</span>
      <span>{reviewStatusText(current)}</span>
      <span>{t("权益包")}</span>
      <span className="min-w-0 wrap-break-word">
        {packages.map((item, index) => (
          <span className="block" key={item.PackageID || `${item.PackageName}-${index}`}>
            {reviewPackageName(item)}
          </span>
        ))}
      </span>
      {current.FailureReason ? (
        <>
          <span>{t("失败原因")}</span>
          <span className="wrap-break-word">{current.FailureReason}</span>
        </>
      ) : null}
    </div>
  );
}

export function AssetReviewMark({ asset, showDetails = false }: { asset: AssetMentionItem; showDetails?: boolean }) {
  const approved = approvedReviews(asset);
  if (approved.length === 0) {
    return null;
  }
  const mark = (
    <span
      aria-label={t("审核状态：{status}", { status: t("审核通过") })}
      className="inline-flex shrink-0 items-center justify-center"
    >
      <ReviewShield tone="approved" />
    </span>
  );
  if (!showDetails) return mark;
  return (
    <Tooltip
      content={renderAssetReviewTooltipContent({
        review: approved.at(-1),
        reviews: approved,
      })}
      position="top"
    >
      {mark}
    </Tooltip>
  );
}

export function AssetReviewFooter({
  asset,
  onSubmit,
  onAddToLibrary,
}: {
  asset: AssetMentionItem;
  onSubmit?: (asset: AssetMentionItem) => void;
  onAddToLibrary?: (asset: AssetMentionItem) => void;
}) {
  const review = asset.review;
  const approved = approvedReviews(asset);
  const canSubmit =
    Boolean(onSubmit) &&
    approved.length === 0 &&
    review?.Status !== assetIDL.AssetReviewStatus.APPROVED &&
    review?.Status !== assetIDL.AssetReviewStatus.SUBMITTING &&
    review?.Status !== assetIDL.AssetReviewStatus.PROCESSING;
  const canAddToLibrary = Boolean(onAddToLibrary) && approved.length > 0;
  const tone = approved.length ? "approved" : reviewTone(review);
  let label = t("未审核");
  let labelClass = "text-muted-foreground";
  let detail: string | undefined;
  let detailClass = "";
  if (approved.length) {
    label = t("审核通过");
    labelClass = "font-medium text-[#3491FA]";
    detail =
      approved.length > 1 ? t("{count}个预置权益包", { count: approved.length }) : reviewPackageName(approved[0]);
    detailClass = "text-[#57A9FB]";
  } else if (review?.Status === assetIDL.AssetReviewStatus.FAILED) {
    label = t("审核未通过");
    labelClass = "font-medium text-[#C04F00]";
    detail = review.FailureReason ? `( ${review.FailureReason} )` : undefined;
    detailClass = "text-[#FF832B]";
  } else if (review) {
    label = t("审核中");
    labelClass = "font-medium text-primary";
  }

  return (
    <div
      className={`group flex h-7 items-center justify-between rounded-[8px] px-2 text-[12px] leading-5 ${
        canSubmit ? "group-hover:bg-muted" : ""
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        <ReviewShield tone={tone} />
        <span className={`shrink-0 ${labelClass}`}>{label}</span>
        {detail ? (
          approved.length > 1 ? (
            <Tooltip
              content={
                <ol className="m-0 list-decimal pl-5">
                  {approved.map((item) => (
                    <li className="wrap-break-word" key={item.PackageID}>
                      {reviewPackageName(item)}
                    </li>
                  ))}
                </ol>
              }
              position="bottom"
            >
              <span
                aria-label={t("{count}个预置权益包：{names}", {
                  count: approved.length,
                  names: approved.map(reviewPackageName).join("、"),
                })}
                className={`min-w-0 flex-1 cursor-help truncate underline decoration-dotted underline-offset-2 ${detailClass}`}
              >
                {detail}
              </span>
            </Tooltip>
          ) : (
            <span className={`min-w-0 flex-1 truncate ${detailClass}`} title={detail}>
              {detail}
            </span>
          )
        ) : null}
      </div>
      {canSubmit || canAddToLibrary ? (
        <button
          className={`shrink-0 cursor-pointer items-center gap-1 border-0 bg-[transparent] p-0 text-[12px] leading-5 text-foreground ${
            canAddToLibrary ? "flex" : "hidden group-hover:flex"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            if (canAddToLibrary) onAddToLibrary?.(asset);
            else onSubmit?.(asset);
          }}
          onMouseDown={(event) => event.preventDefault()}
          type="button"
        >
          {canAddToLibrary ? t("添加到资产库") : t("提交合规审核")}
          <ReviewActionArrow />
        </button>
      ) : null}
    </div>
  );
}
