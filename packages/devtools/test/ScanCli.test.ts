import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const cwd = fileURLToPath(new URL("./fixtures/scan/", import.meta.url))

const scan = (args: ReadonlyArray<string>) => {
  const run = spawnSync(process.execPath, [cli, "scan", ...args], { cwd, encoding: "utf8" })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

const dependency = "node_modules/fake-physics"

describe("ritmo-devtools scan", () => {
  it("reports what the determinism rules flag in a dependency, grouped by package, and exits with 0", () => {
    const run = scan(["game.ts"])
    expect(run).toMatchObject({ status: 0, stderr: "" })
    expect(run.stdout).toBe([
      "fake-physics (5 findings)",
      `  ${dependency}/index.js:4:17  ritmo/use-ops-for-math  Math.sin`,
      `  ${dependency}/index.js:5:18  ritmo/use-ops-for-math  body.y ** 3`,
      `  ${dependency}/index.js:6:32  ritmo/use-random-for-randomness  Math.random`,
      `  ${dependency}/index.js:6:50  ritmo/use-clock-for-time  Date.now`,
      `  ${dependency}/jitter.cjs:1:34  ritmo/use-clock-for-time  performance.now`,
      "",
      "scanned 4 files in 2 packages imported by game.ts: 5 findings in 1 package",
      "These are hints: code the simulation never calls is fine. For a dependency the simulation calls, vendor it into your source and run `oxlint --fix` with these rules on, or replace it; then confirm with Verify.acrossEngines (`ritmo-devtools verify`) or Netcode.syncTest.",
      ""
    ].join("\n"))
  })

  it("prints JSON with --json, the entry's own package first", () => {
    const run = scan(["--json", "game.ts"])
    expect(run.status).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual({
      entry: "game.ts",
      files: 4,
      packages: [
        { name: "scan-fixture-game", files: 2, findings: [] },
        {
          name: "fake-physics",
          files: 2,
          findings: [
            { file: `${dependency}/index.js`, line: 4, column: 17, rule: "ritmo/use-ops-for-math", snippet: "Math.sin" },
            { file: `${dependency}/index.js`, line: 5, column: 18, rule: "ritmo/use-ops-for-math", snippet: "body.y ** 3" },
            { file: `${dependency}/index.js`, line: 6, column: 32, rule: "ritmo/use-random-for-randomness", snippet: "Math.random" },
            { file: `${dependency}/index.js`, line: 6, column: 50, rule: "ritmo/use-clock-for-time", snippet: "Date.now" },
            { file: `${dependency}/jitter.cjs`, line: 1, column: 34, rule: "ritmo/use-clock-for-time", snippet: "performance.now" }
          ]
        }
      ]
    })
  })

  it("says the closure is clean when only exact operations are used", () => {
    const run = scan(["ops.ts"])
    expect(run.status).toBe(0)
    expect(run.stdout).toContain("scanned 1 file in 1 package imported by ops.ts: 0 findings in 0 packages\nNo dependency uses")
  })

  it("exits with 2 on a usage error", () => {
    expect(scan([])).toMatchObject({ status: 2, stderr: expect.stringContaining("ritmo-devtools scan <entry> [--json]") })
    expect(scan(["game.ts", "ops.ts"]).status).toBe(2)
    expect(scan(["missing.ts"])).toMatchObject({ status: 2, stderr: expect.stringContaining("missing.ts could not be read") })
  })
})
