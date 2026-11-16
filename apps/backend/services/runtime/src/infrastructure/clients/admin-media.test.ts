import assert from "node:assert/strict";
import test from "node:test";

import type { AdminProviderSnapshot } from "@backend/transport-ts";

import { toProviderSnapshot } from "./admin-media.js";

void test("video provider snapshots do not require a Responses dialect", () => {
  const provider: AdminProviderSnapshot = {
    id: "video-provider",
    user_id: "user",
    name: "Video provider",
    model: "video-model",
    provider_kind: "video",
    responses_dialect: null,
    base_url: "https://example.com/api/v3",
    api_key: "secret",
    extra_body: { ratio: "16:9" },
    pricing: { currency: "USD", unit: "generated_second", unit_price_micros: 42 },
    context_window: 1024,
    max_output_tokens: 256,
    supports_image_input: false,
    is_default: false,
    is_enabled: true,
  };

  assert.deepEqual(toProviderSnapshot(provider), {
    id: "video-provider",
    name: "Video provider",
    model: "video-model",
    baseUrl: "https://example.com/api/v3",
    apiKey: "secret",
    extraBody: { ratio: "16:9" },
    contextWindow: 1024,
    maxOutputTokens: 256,
    pricing: { currency: "USD", unit: "generated_second", unitPriceMicros: 42 },
  });
});
