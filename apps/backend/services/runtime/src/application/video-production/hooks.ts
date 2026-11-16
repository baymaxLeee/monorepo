import { defineHook } from "workflow";

import {
  publishHookPayloadSchema,
  shotReviewHookPayloadSchema,
  storyboardHookPayloadSchema,
} from "../../domain/video-production/contracts.js";

export const storyboardApprovalHook = defineHook({ schema: storyboardHookPayloadSchema });
export const shotReviewHook = defineHook({ schema: shotReviewHookPayloadSchema });
export const publishApprovalHook = defineHook({ schema: publishHookPayloadSchema });

export function storyboardHookToken(productionId: string): string {
  return `video:${productionId}:storyboard`;
}

export function shotReviewHookToken(productionId: string): string {
  return `video:${productionId}:shot-review`;
}

export function publishHookToken(productionId: string): string {
  return `video:${productionId}:publish`;
}
