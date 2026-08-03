import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const feedbackAutomationToken = "test-feedback-automation-token-with-enough-entropy";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          FEEDBACK_AUTOMATION_TOKEN_SHA256: createHash("sha256")
            .update(feedbackAutomationToken)
            .digest("hex"),
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations"),
          ),
        },
      },
    })),
  ],
  test: {
    include: ["worker/**/*.test.ts"],
  },
});
