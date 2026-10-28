import tsconfigPaths from "vite-tsconfig-paths"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [tsconfigPaths({ ignoreConfigErrors: true })],
  test: {
    include: ["packages/*/test/**/*.test.ts", "integration/*/test/**/*.test.ts", "bench/*/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/dtslint/**"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      exclude: ["node_modules/", "dist/", "coverage/", "dtslint/", "**/*.d.ts", "**/*.config.*"]
    }
  }
})
