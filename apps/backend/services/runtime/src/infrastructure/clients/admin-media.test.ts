import assert from "node:assert/strict";
import test from "node:test";

import { type ModelProvider, PricingUnit, ProviderKind } from "@backend/inner-api/gen/admin/v1/admin";

import { toProviderSnapshot } from "./admin-media.js";

void test("video provider snapshots do not require a Responses dialect", () => {
  const provider: ModelProvider = {
    id: "video-provider",
    userId: "user",
    name: "Video provider",
    model: "video-model",
    providerKind: ProviderKind.PROVIDER_KIND_VIDEO,
    baseUrl: "https://example.com/api/v3",
    apiKey: "secret",
    extraBody: { ratio: "16:9" },
    pricing: { currency: "USD", unit: PricingUnit.PRICING_UNIT_GENERATED_SECOND, unitPriceMicros: 42 },
    contextWindow: 1024,
    maxOutputTokens: 256,
    supportsImageInput: false,
    isDefault: false,
    isEnabled: true,
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
