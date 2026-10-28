import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { toolsVersion } from "@typeonce/ritmo-tools/internal/version.ts"

const bin = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))

describe("ritmo-tools", () => {
  it("prints the package's version", { timeout: 30_000 }, () => {
    const manifest: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    expect(manifest).toMatchObject({ version: toolsVersion })
    const result = spawnSync(process.execPath, [bin, "--version"], { encoding: "utf8" })
    expect(result.stdout).toContain(toolsVersion)
  })

  it("lists its tools", { timeout: 30_000 }, () => {
    const result = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" })
    expect(result.stdout).toContain("pixel")
  })
})
