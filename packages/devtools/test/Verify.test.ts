import { describe, expect, it } from "vitest"
import { Result } from "@typeonce/ritmo"
import type * as Snapshot from "@typeonce/ritmo/Snapshot"
import { Replay, Verify } from "@typeonce/ritmo-devtools"

import { Input, makeGame, record, replayTarget } from "./fixtures/replay-entry.ts"

const file = record([1, 2, 3, 0, 0, 5])

/** An engine that runs the game in this process, its results passed through `change`. */
const engine = (
  name: string,
  change: { readonly hashes?: (hashes: Verify.Hashes) => Verify.Hashes; readonly snapshot?: (snapshot: Snapshot.WorldSnapshot) => Snapshot.WorldSnapshot } = {}
): Verify.Engine => ({
  name,
  trace: async (input) => {
    const traced = Verify.trace(replayTarget, input)
    return traced.ok ? Result.success((change.hashes ?? ((hashes) => hashes))(traced.value)) : Result.failure({ _tag: "EngineFailed", engine: name, message: traced.error._tag })
  },
  snapshotAt: async (input, tick) => {
    const snapshot = Verify.snapshotAt(replayTarget, input, tick)
    return snapshot.ok ? Result.success((change.snapshot ?? ((value) => value))(snapshot.value)) : Result.failure({ _tag: "EngineFailed", engine: name, message: snapshot.error._tag })
  }
})

/** The mover's x moved by one. */
const nudged = (snapshot: Snapshot.WorldSnapshot): Snapshot.WorldSnapshot => ({
  ...snapshot,
  entities: snapshot.entities.map((entity) => ({ ...entity, components: { ...entity.components, "VerifyFixture/Position": { x: 100 } } }))
})

const outcomes = (result: Result.Result<unknown, Verify.VerifyError>) =>
  !result.ok && result.error._tag === "NotVerified" ? result.error.outcomes : []

describe("Verify", () => {
  it("traces the checksum after every tick, the start's first", () => {
    const traced = Verify.trace(replayTarget, file)
    expect(traced.ok).toBe(true)
    if (!traced.ok) return
    expect(traced.value.map(({ tick }) => tick)).toEqual([0, 1, 2, 3, 4, 5, 6])
    // The checkpoints recorded are the same hashes.
    for (const { tick, hash } of file.checkpoints) expect(traced.value.find((entry) => entry.tick === tick)?.hash).toBe(hash)
  })

  it("loads the world at the end of a tick", () => {
    const at = Verify.snapshotAt(replayTarget, file, 3)
    expect(at.ok && at.value.entities[0]?.components["VerifyFixture/Position"]).toEqual({ x: 6 })
  })

  it("verifies in this process alone", async () => {
    const verified = await Verify.acrossEngines(replayTarget, file)
    expect(verified.ok && verified.value.data).toEqual({ schedule: "update", ticks: 6, engines: ["node"] })
    expect(verified.ok && verified.value.text).toBe("verified 6 ticks of update on node: every engine reaches the same world as node after every tick, and node matches the recording")
  })

  it("verifies engines that agree", async () => {
    const verified = await Verify.acrossEngines(replayTarget, file, { engines: [engine("chromium"), engine("webkit")] })
    expect(verified.ok && verified.value.data.engines).toEqual(["node", "chromium", "webkit"])
  })

  it("names the first tick an engine differs on, and every value that differs there", async () => {
    const differs = engine("webkit", {
      hashes: (hashes) => hashes.map((entry) => entry.tick >= 4 ? { ...entry, hash: "00000000" } : entry),
      snapshot: nudged
    })
    const verified = await Verify.acrossEngines(replayTarget, file, { engines: [engine("chromium"), differs] })
    expect(outcomes(verified)).toEqual([
      { _tag: "Agreed", engine: "node", ticks: 6 },
      { _tag: "Agreed", engine: "chromium", ticks: 6 },
      {
        _tag: "Diverged", engine: "webkit", against: "node", tick: 4, unexplained: undefined,
        differences: [{ path: "entity 1 VerifyFixture/Position.x", entity: 1, mine: 6, theirs: 100 }]
      }
    ])
    expect(!verified.ok && verified.error.text).toBe([
      "NOT verified: 6 ticks of update",
      "node: agrees with a second node run and the recording over 6 ticks",
      "chromium: agrees with node over 6 ticks",
      "tick 4: webkit differs from node in e1 VerifyFixture/Position.x (6 -> 100)",
      "  1 difference (node -> webkit):",
      "    e1 VerifyFixture/Position.x: 6 -> 100"
    ].join("\n"))
  })

  it("says when the worlds at a differing tick save the same", async () => {
    const verified = await Verify.acrossEngines(replayTarget, file, { engines: [engine("firefox", { hashes: (hashes) => hashes.slice(0, -1) })] })
    expect(outcomes(verified)[1]).toMatchObject({ _tag: "Diverged", tick: 6, differences: [], unexplained: expect.stringContaining("the saves are equal") })
  })

  it("reports an engine that is missing or failed, never skips it", async () => {
    const missing: Verify.Engine = {
      name: "firefox",
      trace: async () => Result.failure({ _tag: "EngineMissing", engine: "firefox", reason: "the firefox browser is not downloaded", install: "npx playwright install firefox" }),
      snapshotAt: async () => Result.failure({ _tag: "EngineFailed", engine: "firefox", message: "unused" })
    }
    const broken: Verify.Engine = { ...missing, name: "webkit", trace: async () => Result.failure({ _tag: "EngineFailed", engine: "webkit", message: "the game threw" }) }
    const verified = await Verify.acrossEngines(replayTarget, file, { engines: [missing, broken] })
    expect(outcomes(verified).map((outcome) => outcome._tag)).toEqual(["Agreed", "EngineMissing", "EngineFailed"])
    expect(!verified.ok && verified.error.text).toContain("firefox: not installed (the firefox browser is not downloaded): npx playwright install firefox")
    expect(!verified.ok && verified.error.text).toContain("webkit: failed: the game threw")
  })

  it("finds a game that plays differently on a second run here", async () => {
    let builds = 0
    const drifting = (playback: Replay.Playback) => {
      const shift = builds++
      return makeGame(playback.source(Input), () => shift)
    }
    const verified = await Verify.acrossEngines(drifting, file)
    expect(outcomes(verified)[0]).toMatchObject({ _tag: "Diverged", engine: "node", against: "node", tick: 1 })
    expect(!verified.ok && verified.error.text).toContain("tick 1: node differs from a second node run in e1 VerifyFixture/Position.x")
  })

  it("finds a replay that no longer matches its recording", async () => {
    const stale = { ...file, checkpoints: file.checkpoints.map((checkpoint) => checkpoint.tick === 4 ? { ...checkpoint, hash: "00000000" } : checkpoint) }
    const verified = await Verify.acrossEngines(replayTarget, stale)
    expect(outcomes(verified)[0]).toEqual({ _tag: "Diverged", engine: "node", against: "recording", tick: 4, differences: [], unexplained: "the recording holds only a hash at this tick" })
  })

  it("verifies a replay saved as JSON while the world holds -0", async () => {
    // JSON writes -0 as 0, so a replay read back from disk holds 0 where the recording held -0.
    const saved: Replay.ReplayFile = JSON.parse(JSON.stringify(record([-0, -0, -0], -0)))
    const verified = await Verify.acrossEngines(replayTarget, saved)
    expect(verified.ok).toBe(true)
  })

  it("fails with ReplayInvalid when the replay does not open here", async () => {
    const verified = await Verify.acrossEngines(replayTarget, { ...file, schema: "00000000" })
    expect(verified).toMatchObject({ ok: false, error: { _tag: "ReplayInvalid", error: { _tag: "SchemaMismatch" } } })
  })
})
