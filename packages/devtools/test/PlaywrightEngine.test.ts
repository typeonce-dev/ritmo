import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"
import { Verify } from "@typeonce/ritmo-devtools"
import * as PlaywrightEngine from "@typeonce/ritmo-devtools/PlaywrightEngine"

import { record, replayTarget } from "./fixtures/replay-entry.ts"
import { replayTarget as browserDiffers } from "./fixtures/replay-engine-entry.ts"

// The browsers are downloaded only where the cross-engine check runs (the CI job "Determinism across engines").
const skipped = await (async () => {
  try {
    const playwright = await import("playwright")
    return existsSync(playwright.chromium.executablePath()) ? undefined : "chromium is not downloaded (npx playwright install chromium)"
  } catch {
    return "playwright is not installed"
  }
})()
if (skipped !== undefined) console.warn(`PlaywrightEngine tests skipped: ${skipped}`)

const file = record([1, 2, 3, 0, 0, 5])
const opened: Array<PlaywrightEngine.Engines> = []
const chromium = (entry: string) => {
  const engines = PlaywrightEngine.make({ entry: fileURLToPath(new URL(entry, import.meta.url)), browsers: ["chromium"] })
  opened.push(engines)
  return engines.engines
}
afterAll(async () => {
  await Promise.all(opened.map((engines) => engines.close()))
})

describe.skipIf(skipped !== undefined)("PlaywrightEngine", () => {
  it("plays the replay in a browser to the same world as Node", async () => {
    const verified = await Verify.acrossEngines(replayTarget, file, { engines: chromium("./fixtures/replay-entry.ts") })
    expect(verified.ok && verified.value.data.engines).toEqual(["node", "chromium"])
  }, 60_000)

  it("names the tick and the value a browser differs on", async () => {
    const verified = await Verify.acrossEngines(browserDiffers, file, { engines: chromium("./fixtures/replay-engine-entry.ts") })
    expect(!verified.ok && verified.error._tag === "NotVerified" && verified.error.outcomes[1]).toEqual({
      _tag: "Diverged", engine: "chromium", against: "node", tick: 3, unexplained: undefined,
      differences: [{ path: "entity 1 VerifyFixture/Position.x", entity: 1, mine: 6, theirs: 7 }]
    })
  }, 60_000)

  it("fails an entry that does not load in the browser", async () => {
    const verified = await Verify.acrossEngines(replayTarget, file, { engines: chromium("./fixtures/lint-entry.ts") })
    expect(!verified.ok && verified.error._tag === "NotVerified" && verified.error.outcomes[1]).toMatchObject({
      _tag: "EngineFailed", engine: "chromium", message: expect.stringContaining("must export replayTarget")
    })
  }, 60_000)
})
