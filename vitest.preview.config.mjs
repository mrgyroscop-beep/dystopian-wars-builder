import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/preview/**/*.test.mjs"],
  },
});
