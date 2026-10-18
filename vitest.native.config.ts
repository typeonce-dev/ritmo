import { defineConfig } from "vitest/config"
import shared from "./vitest.shared.ts"
export default defineConfig({ ...shared, test: {
  ...shared.test, include: ["packages/core/test/**/*.test.ts"], setupFiles: ["packages/core/test/native.setup.ts"]
} })
