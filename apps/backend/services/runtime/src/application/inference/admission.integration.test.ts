import test from "node:test";

if (process.env.LOCAL_INFERENCE_TEST_URL) {
  await import("./admission.postgres.js");
} else {
  test.skip("local inference admission allows concurrent requests (requires isolated PostgreSQL)", () => {});
}
