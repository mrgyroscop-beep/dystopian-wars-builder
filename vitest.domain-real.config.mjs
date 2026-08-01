import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/domain/real-integration.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    restoreMocks: true,
    maxWorkers: 1,
  },
});
