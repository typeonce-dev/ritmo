import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import type * as Schedule from "@typeonce/ritmo/Schedule"
import { Fuzz, Invariant, Replay } from "@typeonce/ritmo-devtools"
import * as Codecs from "../../core/test/codecs.ts"

const Health = Descriptor.ConstructedComponent(Codecs.number)("Fuzz/Health")
const Progress = Descriptor.ConstructedResource(Codecs.number)("Fuzz/Progress")
/** A pad: which key is down (0 for none), and where the stick points, which no system reads. */
type Pad = { readonly key: number; readonly aim: number }
const PadInput = Descriptor.Service<Schedule.Source<Pad>>()("Fuzz/Pad")
const Rules = Descriptor.Service<{ readonly combo: ReadonlyArray<number> }>()("Fuzz/Rules")
const Game = Schema.bind(Schema.fragment({ components: { Health }, resources: { Progress } }))

const Spawn = Game.System("Fuzz/Spawn", { commands: Game.System.commands(Game.System.spawns(Health)) }, ({ commands }) => {
  const draft = Game.Command.spawn(Game.Command.entryRaw(Health, 3))
  if (draft.ok) commands.spawn(draft.value)
})
/**
 * The planted bug: pressing the combo's keys in order (other keys reset it,
 * no key keeps it) deals 10 damage to a player with 3 health, and health has
 * no floor.
 */
const Combo = Game.System("Fuzz/Combo", {
  queries: { players: Game.Query({ selection: { health: Game.Query.write(Health) } }) },
  resources: { progress: Game.System.writeResource(Progress) },
  services: { pad: Game.System.service(PadInput), rules: Game.System.service(Rules) }
}, ({ queries, resources, services }) => {
  const { key } = services.pad.snapshot()
  if (key === 0) return
  const { combo } = services.rules
  const progress = combo[resources.progress.get()] === key ? resources.progress.get() + 1 : 0
  if (progress < combo.length) {
    resources.progress.set(progress)
    return
  }
  resources.progress.set(0)
  for (const { data } of queries.players.each()) data.health.setRaw(data.health.get() - 10)
})
const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
const update = Game.Schedule(Combo)

const Alive = Invariant.fromInspector(Game.Inspector("health never negative", {
  queries: { players: Game.Query({ selection: { health: Game.Query.read(Health) } }) }
}, ({ queries }) => {
  const low = queries.players.each().map(({ data }) => data.health.get()).filter((health) => health < 0)
  return low.length > 0 ? `health ${low.join(", ")}` : undefined
}))

const hostClock = HostClock.test()

/** The factory a replay of this game opens with: the fuzzed or recorded pad, the rules as they are. */
const make = (playback: Replay.Playback) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(PadInput, playback.source(PadInput)), Game.Runtime.service(Rules, { combo: [1, 2, 3, 1] })),
    resources: { Progress: 0 },
    debug: { hostClock }
  })
  if (!made.ok) throw new Error("fixture")
  return { runtime: made.value, schedules: { setup, update }, hostClock }
}

const Pads = Fuzz.input(PadInput, {
  generate: (random) => ({ key: random.integer(0, 5), aim: random.integer(-3, 4) }),
  neutral: { key: 0, aim: 0 }
})

const keysOf = (file: Replay.ReplayFile) => file.ticks.map((record) => (record.services?.[PadInput.name]?.[0] as Pad | undefined))

describe("Fuzz.run", () => {
  it("finds the combo, shrinks it to its four presses, and saves a replay that reproduces it", () => {
    const found = Fuzz.run(make, { schedule: "update", setup: "setup", inputs: [Pads], invariants: [Alive], frames: 1000, seed: 7 })
    if (found.ok || found.error._tag !== "Found") throw new Error(JSON.stringify(found))
    const { violation, replay, shrink, frame, seed, reproduces } = found.error
    expect(violation).toEqual({ _tag: "InvariantViolated", invariant: "health never negative", message: "health -7" })
    expect(seed).toBeGreaterThanOrEqual(7)
    // Only the combo is left, each press with the stick at rest.
    expect(frame).toBe(4)
    expect(keysOf(replay)).toEqual([{ key: 1, aim: 0 }, { key: 2, aim: 0 }, { key: 3, aim: 0 }, { key: 1, aim: 0 }])
    expect(shrink.fromFrames).toBeGreaterThan(4)
    expect(shrink.toFrames).toBe(4)
    expect(shrink.steps).toBeGreaterThan(0)
    expect(shrink.attempts).toBeGreaterThanOrEqual(shrink.steps)
    expect(replay.reason).toContain(`fuzz seed ${seed}: invariant health never negative broke: health -7 at frame 4`)
    expect(reproduces).toBe(true)

    // The test that locks the bug in: the saved file, through JSON, plays to the same violation.
    const parsed = Replay.parse(JSON.parse(JSON.stringify(replay)))
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const opened = Replay.session(make, parsed.value, { invariants: [Alive] })
    if (!opened.ok) throw new Error(JSON.stringify(opened.error))
    expect(opened.value.play().data.run.stop).toMatchObject({ reason: "invariant", invariant: "health never negative", message: "health -7" })
  })

  it("is deterministic: the same seed finds the same replay", () => {
    const options = { schedule: "update", setup: "setup", inputs: [Pads], invariants: [Alive], frames: 1000, seed: 7 } as const
    const first = Fuzz.run(make, options)
    const second = Fuzz.run(make, options)
    expect(first.ok).toBe(false)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    // The reported seed alone, in one run, finds it again.
    if (first.ok || first.error._tag !== "Found") throw new Error("expected a bug")
    const again = Fuzz.run(make, { ...options, seed: first.error.seed, runs: 1 })
    expect(again.ok || again.error._tag !== "Found" ? undefined : again.error.replay.ticks).toEqual(first.error.replay.ticks)
  })

  it("passes when no input breaks anything", () => {
    const harmless = Fuzz.input(PadInput, { generate: (random) => ({ key: random.pick([0, 4]) ?? 0, aim: 0 }), neutral: { key: 0, aim: 0 } })
    const passed = Fuzz.run(make, { schedule: "update", setup: "setup", inputs: [harmless], invariants: [Alive], frames: 50, runs: 3, seed: 1 })
    expect(passed).toMatchObject({ ok: true, value: { data: { runs: 3, frames: 50, seed: 1 } } })
    if (passed.ok) expect(passed.value.text).toBe("3 runs of 50 frames from seed 1: no invariant broke, no system failed, nothing threw")
  })

  it("finds failed systems and thrown defects", () => {
    const Guard = Game.System("Fuzz/Guard", { services: { pad: Game.System.service(PadInput) } }, ({ services }) =>
      services.pad.snapshot().key === 4 ? Result.failure("FourPressed" as const) : undefined)
    const failing = (playback: Replay.Playback) => ({ ...make(playback), schedules: { setup, update: Game.Schedule(Guard) } })
    const failed = Fuzz.run(failing, { schedule: "update", setup: "setup", inputs: [Pads], frames: 100, seed: 3 })
    expect(failed.ok ? undefined : failed.error).toMatchObject({ _tag: "Found", frame: 1, violation: { _tag: "SystemFailed", system: "Fuzz/Guard", error: "FourPressed" } })

    const Crash = Game.System("Fuzz/Crash", { services: { pad: Game.System.service(PadInput) } }, ({ services }) => {
      if (services.pad.snapshot().aim === 3) throw new Error("aim overflow")
    })
    const crashing = (playback: Replay.Playback) => ({ ...make(playback), schedules: { setup, update: Game.Schedule(Crash) } })
    const crashed = Fuzz.run(crashing, { schedule: "update", inputs: [Pads], frames: 100, seed: 3 })
    if (crashed.ok || crashed.error._tag !== "Found") throw new Error(JSON.stringify(crashed))
    expect(crashed.error.violation).toMatchObject({ _tag: "Defect", invariant: undefined })
    // The key does not matter, so shrinking sets it back to neutral.
    expect(keysOf(crashed.error.replay)).toEqual([{ key: 0, aim: 3 }])
  })

  it("reports a simulation that does not repeat its failure as flaky", () => {
    let calls = 0
    const Noise = Game.System("Fuzz/Noise", { resources: { progress: Game.System.writeResource(Progress) } }, () => {
      // State outside the world, like Math.random: the first simulation fails, no later one does.
      calls += 1
      return calls === 5 ? Result.failure("Unlucky" as const) : undefined
    })
    const noisy = (playback: Replay.Playback) => ({ ...make(playback), schedules: { setup, update: Game.Schedule(Combo, Noise) } })
    const result = Fuzz.run(noisy, { schedule: "update", inputs: [Pads], frames: 10, seed: 1 })
    expect(result.ok ? undefined : result.error).toMatchObject({ _tag: "Flaky", seed: 1, frame: 5, violation: { _tag: "SystemFailed", system: "Fuzz/Noise" } })
  })

  it("rejects options and factories it cannot fuzz", () => {
    expect(Fuzz.run(make, { schedule: "update", inputs: [Pads], frames: 0, seed: 1 })).toMatchObject({ ok: false, error: { _tag: "InvalidOptions", message: "frames must be a whole number above 0" } })
    expect(Fuzz.run(make, { schedule: "update", inputs: [Pads, Pads], frames: 10, seed: 1 })).toMatchObject({ ok: false, error: { _tag: "InvalidOptions", message: "each input must fuzz a different source" } })
    const Other = Descriptor.Service<Schedule.Source<number>>()("Fuzz/Other")
    const unread = Fuzz.input(Other, { generate: (random) => random.integer(0, 3), neutral: 0 })
    expect(Fuzz.run(make, { schedule: "update", inputs: [Pads, unread], frames: 10, seed: 1 })).toMatchObject({
      ok: false, error: { _tag: "InvalidOptions", message: "make never asked playback.source for Fuzz/Other: provide the fuzzed source with playback.source(...)" }
    })
    expect(Fuzz.run(make, { schedule: "update", inputs: [unread], frames: 10, seed: 1 })).toMatchObject({
      ok: false, error: { _tag: "InvalidOptions", message: "make asked playback.source for Fuzz/Pad, which no input fuzzes: add Fuzz.input for it, or provide it directly" }
    })
  })

  it("stops shrinking at the attempt budget", () => {
    const found = Fuzz.run(make, { schedule: "update", setup: "setup", inputs: [Pads], invariants: [Alive], frames: 1000, seed: 7, shrinkAttempts: 3 })
    if (found.ok || found.error._tag !== "Found") throw new Error(JSON.stringify(found))
    expect(found.error.shrink.attempts).toBe(3)
    expect(found.error.frame).toBeGreaterThan(4)
    expect(found.error.reproduces).toBe(true)
  })
})
