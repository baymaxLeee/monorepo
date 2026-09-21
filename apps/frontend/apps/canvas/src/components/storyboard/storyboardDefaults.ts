import type { CanvasStoryboardDraftInput } from "@repo/api";

export const storyboardDefaults: CanvasStoryboardDraftInput = {
  operation_id: "",
  plot: "",
  provider_id: "",
  parameters: null,
  duration_min: 4,
  duration_max: 15,
  total_duration_min: 60,
  total_duration_max: 180,
  video_config: {
    provider_id: "",
    resolution: "720p",
    aspect_ratio: "16:9",
    duration_seconds: 5,
    generate_audio: true,
    watermark: false,
  },
};
