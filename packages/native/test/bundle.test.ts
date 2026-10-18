import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { runInNewContext } from "node:vm"
import { expect, it } from "vitest"
import { bundle } from "@typeonce/ritmo-native/compiler/bundle.ts"

it("runs 600 unchanged top-down frames without DOM globals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ritmo-bundle-"))
  try {
    await bundle(resolve("packages/native/spikes/top-down.ts"), join(dir, "game.js"))
    const snapshots: string[] = []
    runInNewContext(await readFile(join(dir, "game.js"), "utf8"), { console: { log: (line: string) => snapshots.push(line) } })
    expect(snapshots).toHaveLength(600)
    expect(JSON.parse(snapshots[599]!).entities.length).toBeGreaterThan(0)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
