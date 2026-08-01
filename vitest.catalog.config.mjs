import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/catalog/**/*.test.mjs"],
    restoreMocks: true,
    testTimeout: 15_000,
  },
});
