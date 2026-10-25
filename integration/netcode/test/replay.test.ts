import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { Replay, Verify } from "@typeonce/ritmo-devtools"

import { matchPath, record } from "../replay/record.ts"
import { replayTarget } from "../replay/target.ts"

// CI verifies match.json in Chromium, WebKit, and Firefox too ("Determinism across engines").
describe("the committed netcode replay", () => {
  const committed = Replay.parse(JSON.parse(readFileSync(matchPath, "utf8")))

  it("is what record.ts writes today (else rerun: node --import tsx integration/netcode/replay/record.ts)", () => {
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    // The devtools version changes on every release and the replay plays the same.
    expect({ ...committed.value, library: "" }).toEqual({ ...JSON.parse(JSON.stringify(record())), library: "" })
  })

  it("verifies in Node: deterministic, and the same as its recording", async () => {
    if (!committed.ok) throw new Error(JSON.stringify(committed.error))
    const verified = await Verify.acrossEngines(replayTarget, committed.value)
    expect(verified.ok ? verified.value.text : verified.error.text).toBe(
      "verified 600 ticks of simulate on node: every engine reaches the same world as node after every tick, and node matches the recording"
    )
  })
})
