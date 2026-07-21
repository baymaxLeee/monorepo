import {
  fetchVideoTakePreview,
  type VideoProductionShotReviewsItem,
  type VideoShot,
  type VideoTake,
} from "api";
import { Badge, Button } from "components";
import { CheckIcon, Loader2Icon, RotateCcwIcon } from "lucide-react";
import { useEffect, useState } from "react";

function TakePreview({
  conversationId,
  productionId,
  shotId,
  take,
}: {
  conversationId: string;
  productionId: string;
  shotId: string;
  take: VideoTake;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!take.stagedMediaId) return;
    let active = true;
    let objectUrl: string | null = null;
    void fetchVideoTakePreview(conversationId, productionId, shotId, take.id)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [conversationId, productionId, shotId, take.id, take.stagedMediaId]);
  if (!url) return null;
  return (
    // biome-ignore lint/a11y/useMediaCaption: generated take previews do not have VTT artifacts
    <video className="mt-2 w-full rounded border bg-black" controls src={url} />
  );
}

export function VideoTakeReview({
  conversationId,
  productionId,
  shots,
  reviews,
  disabled,
  onRetry,
  onApprove,
}: {
  conversationId: string;
  productionId: string;
  shots: VideoShot[];
  reviews: VideoProductionShotReviewsItem[];
  disabled: boolean;
  onRetry: (shotId: string) => Promise<void>;
  onApprove: (
    selections: Array<{ shotId: string; takeId: string }>,
  ) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  useEffect(() => {
    setSelected((current) =>
      Object.fromEntries(
        reviews.flatMap((review) => {
          const currentTake = review.takes.find(
            (candidate) =>
              candidate.id === current[review.shotId] &&
              candidate.status === "succeeded",
          );
          const take =
            currentTake ??
            review.takes.find(
              (candidate) => candidate.id === review.selectedTakeId,
            ) ??
            [...review.takes]
              .reverse()
              .find((candidate) => candidate.status === "succeeded");
          return take ? [[review.shotId, take.id]] : [];
        }),
      ),
    );
  }, [reviews]);

  const complete =
    reviews.length > 0 &&
    reviews.every((review) => {
      const takeId = selected[review.shotId];
      return review.takes.some(
        (take) => take.id === takeId && take.status === "succeeded",
      );
    });

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">镜头 Take 审核</h3>
      {reviews.map((review) => {
        const shot = shots.find((candidate) => candidate.id === review.shotId);
        return (
          <article
            key={review.shotId}
            className="space-y-2 rounded-lg border p-3"
          >
            <div className="flex items-center justify-between text-xs">
              <span>镜头 {(shot?.order ?? 0) + 1}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => void onRetry(review.shotId)}
              >
                <RotateCcwIcon className="mr-1 size-3" />
                重拍
              </Button>
            </div>
            {review.takes.map((take) => (
              <div key={take.id} className="rounded border p-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left text-xs"
                  disabled={take.status !== "succeeded" || disabled}
                  onClick={() =>
                    setSelected((current) => ({
                      ...current,
                      [review.shotId]: take.id,
                    }))
                  }
                >
                  <span>Take {take.number}</span>
                  <Badge
                    variant={
                      selected[review.shotId] === take.id
                        ? "default"
                        : "secondary"
                    }
                  >
                    {take.status === "succeeded"
                      ? selected[review.shotId] === take.id
                        ? "已选择"
                        : "可选择"
                      : "失败"}
                  </Badge>
                </button>
                {take.error ? (
                  <p className="mt-1 text-xs text-destructive">{take.error}</p>
                ) : null}
                <TakePreview
                  conversationId={conversationId}
                  productionId={productionId}
                  shotId={review.shotId}
                  take={take}
                />
              </div>
            ))}
          </article>
        );
      })}
      <Button
        className="w-full"
        disabled={!complete || disabled}
        onClick={() =>
          void onApprove(
            reviews.map((review) => ({
              shotId: review.shotId,
              takeId: selected[review.shotId]!,
            })),
          )
        }
      >
        {disabled ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <CheckIcon className="mr-2 size-4" />
        )}
        批准所选 Take 并合成
      </Button>
    </section>
  );
}
