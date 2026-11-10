import { describe, expect, it } from "vitest"
import { Clock, Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import * as Codecs from "../../core/test/codecs.ts"
import type * as Schedule from "@typeonce/ritmo/Schedule"
import { Fuzz, Invariant, Replay, Verify } from "@typeonce/ritmo-devtools"

const hostClock = HostClock.test()

const Thing = Descriptor.ConstructedComponent(Codecs.struct({ x: Codecs.number }))("Window/Thing")
const Heard = Descriptor.ConstructedResource(Codecs.number)("Window/Heard")
const Born = Descriptor.ConstructedResource(Codecs.number)("Window/Born")
const Scratch = Descriptor.TransientResource<number>()("Window/Scratch")
const Mirror = Descriptor.ConstructedResource(Codecs.number)("Window/Mirror")
const Ping = Descriptor.Event<number>()("Window/Ping")
const Input = Descriptor.Service<Schedule.Source<{ readonly dx: number }>>()("Window/Input")
const Root = Schema.defineRoot("Window")
const Game = Schema.bind(Schema.fragment({ components: { Thing }, resources: { Heard, Born, Scratch, Mirror }, events: { Ping } }), Root)

const Spawn = Game.System("Window/Spawn", {
  commands: Game.System.commands(Game.System.spawns(Thing)),
  events: { ping: Game.System.writeEvent(Ping) }
}, ({ commands, events }) => {
  for (let x = 0; x < 3; x++) {
    commands.spawn(Game.Command.spawn([Thing, { x }]))
  }
  events.ping.emit(100)
})
const Hear = Game.System("Window/Hear", {
  events: { ping: Game.System.readEvent(Ping) },
  resources: { heard: Game.System.writeResource(Heard) }
}, ({ events, resources }) => {
  const total = events.ping.all().reduce((sum, value) => sum + value, 0)
  if (total !== 0) resources.heard.update((heard) => heard + total)
})
const CountBorn = Game.System("Window/CountBorn", {
  queries: { born: Game.Query({ selection: { thing: Game.Query.read(Thing) }, filters: [Game.Query.added(Thing)] }) },
  resources: { born: Game.System.writeResource(Born) }
}, ({ queries, resources }) => {
  const count = queries.born.each().length
  if (count > 0) resources.born.update((born) => born + count)
})
const Emit = Game.System("Window/Emit", {
  events: { ping: Game.System.writeEvent(Ping) },
  services: { input: Game.System.service(Input) }
}, ({ events, services }) => {
  events.ping.emit(services.input.snapshot().dx)
})
const Copy = Game.System("Window/Copy", {
  resources: { scratch: Game.System.writeResource(Scratch), mirror: Game.System.writeResource(Mirror) }
}, ({ resources }) => {
  resources.scratch.update((scratch) => scratch + 1)
  resources.mirror.set(resources.scratch.get())
})
const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
// Reads on each tick what the tick before emitted: a window's start holds none of it.
const events = Game.Schedule(Hear, Emit)
// Counts each Thing once, the first tick it sees it: a window's start does not know which it saw.
const added = Game.Schedule(CountBorn)
// Saves a count kept in a transient resource: a save does not hold the transient one.
const transient = Game.Schedule(Copy)

const runtimeOf = (input: Schedule.Source<{ readonly dx: number }>) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Input, input)),
    resources: { Heard: 0, Born: 0, Scratch: 0, Mirror: 0 },
    debug: { hostClock }
  })
  if (!made.ok) throw new Error("fixture")
  return made.value
}
const make = (playback: Replay.Playback) => ({ runtime: runtimeOf(playback.source(Input)), schedules: { setup, events, added, transient }, hostClock })

/** Plays 20 ticks of `schedule` after setup, recording the last `keep` of them, and opens the replay. */
const recorded = { events, added, transient }

const replayOf = (name: keyof typeof recorded, keep: number) => {
  const schedule = recorded[name]
  let tick = 0
  const runtime = runtimeOf({ snapshot: () => ({ dx: 1 + (tick % 3) }) })
  runtime.tick(setup)
  const recorder = Replay.recorder(runtime, { schedule, name, keep, step: Clock.hz(1), every: 2, sink: Replay.memorySink(), hostClock })
  for (; tick < 20; tick++) runtime.tick(schedule)
  const file = recorder.save("test")
  recorder.stop()
  const opened = Replay.session(make, file)
  if (!opened.ok) throw new Error(JSON.stringify(opened.error))
  return { runtime, file, opened: opened.value, played: opened.value.play() }
}

/** Plays `schedule` 20 ticks on a runtime that has not ticked, recording from its first tick. */
const fromFirstTick = () => {
  let tick = 0
  const runtime = runtimeOf({ snapshot: () => ({ dx: 1 + (tick % 3) }) })
  const recorder = Replay.recorder(runtime, { schedule: events, name: "events", keep: 30, step: Clock.hz(1), every: 2, sink: Replay.memorySink(), hostClock })
  for (; tick < 20; tick++) runtime.tick(events)
  const file = recorder.save("test")
  recorder.stop()
  return { runtime, file }
}

describe("a replay of a rolling window", () => {
  it("does not call events read the tick after a divergence", () => {
    const { runtime, file, opened, played } = replayOf("events", 6)
    expect(file.start.tick).toBe(14)
    expect(played.data.run.stop).toEqual({ reason: "completed" })
    expect(played.data.checkpoints).toEqual({ _tag: "NotCompared", reason: expect.stringContaining("a save does not hold events in flight") })
    expect(played.text).toContain("starts from a save at tick 14: checksums are not compared (a save does not hold events in flight or what each reader had already seen)")
    expect(played.text).not.toContain("DIVERGED")
    // It still plays: the replayed ticks are in the session, and the input is the recorded one.
    expect(opened.session.whyResource(Heard).text).toContain("Window/Hear")
    expect(opened.hashes().size).toBe(7)
    expect(runtime.inspect(Game.Inspector("heard", { resources: { heard: Game.System.readResource(Heard) } }, ({ resources }) => resources.heard.get()))).toBeGreaterThan(0)
  })

  it("does not call an added() query a divergence", () => {
    const { played } = replayOf("added", 6)
    expect(played.data.checkpoints._tag).toBe("NotCompared")
    expect(played.text).toContain("starts from a save at tick 14")
    expect(played.text).not.toContain("DIVERGED")
  })

  it("does not call a transient resource a divergence", () => {
    const { played } = replayOf("transient", 6)
    expect(played.data.run.stop).toEqual({ reason: "completed" })
    expect(played.data.checkpoints._tag).toBe("NotCompared")
  })

  it("does not compare with the recording in Verify.acrossEngines either, and says so", async () => {
    const { file } = replayOf("events", 6)
    const verified = await Verify.acrossEngines(make, file)
    if (!verified.ok) throw new Error(JSON.stringify(verified.error))
    expect(verified.value.data).toMatchObject({ recording: "notCompared", engines: ["node"], ticks: 6 })
    expect(verified.value.text).toContain("the recording starts from a save at tick 14: checksums are not compared")
  })

  it("compares a recording from the first tick, and it matches", async () => {
    const { runtime, file } = fromFirstTick()
    expect(file.start.tick).toBe(0)
    const opened = Replay.session(make, file)
    if (!opened.ok) throw new Error(JSON.stringify(opened.error))
    const played = opened.value.play()
    expect(played.data.checkpoints).toEqual({ _tag: "Compared", diverged: [] })
    expect(played.text).toContain("checkpoints match")
    expect(opened.value.snapshot()).toEqual(runtime.snapshot())
    expect(await Verify.acrossEngines(make, file)).toMatchObject({ ok: true, value: { data: { recording: "matched" } } })
  })

  it("still reports a real divergence in a recording from the first tick", () => {
    const { file } = fromFirstTick()
    let calls = 0
    // Something the replay does not hold: a counter outside the world, like Math.random or wall time.
    const Noise = Game.System("Window/Noise", { resources: { heard: Game.System.writeResource(Heard) } }, ({ resources }) => {
      calls += 1
      resources.heard.set(calls * 1000)
    })
    const noisy = (playback: Replay.Playback) => ({ ...make(playback), schedules: { events: Game.Schedule(Hear, Emit, Noise) } })
    const opened = Replay.session(noisy, file)
    if (!opened.ok) throw new Error(JSON.stringify(opened.error))
    const played = opened.value.play()
    expect(played.data.checkpoints._tag).toBe("Compared")
    expect(played.data.checkpoints._tag === "Compared" && played.data.checkpoints.diverged.map(({ tick }) => tick)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20])
    expect(played.text).toContain("DIVERGED at tick 2")
  })
})

describe("a fuzz run and its replay", () => {
  const Dx = Fuzz.input(Input, { generate: (random) => ({ dx: random.integer(0, 3) }), neutral: { dx: 0 } })
  const heardBelow = (limit: number) => Invariant.fromInspector(Game.Inspector(`heard below ${limit}`, {
    resources: { heard: Game.System.readResource(Heard) }
  }, ({ resources }) => resources.heard.get() >= limit ? `heard ${resources.heard.get()}` : undefined))

  it("start from the same world: a bug the run finds, the replay plays to", () => {
    // Setup emits 100, read on the first frame: the run used to see it and the replay, which loads a save, did not.
    const HeardLow = heardBelow(20)
    const found = Fuzz.run(make, { schedule: "events", setup: "setup", inputs: [Dx], invariants: [HeardLow], frames: 50, runs: 1, seed: 1 })
    if (found.ok || found.error._tag !== "Found") throw new Error(JSON.stringify(found))
    expect(found.error.violation).toMatchObject({ _tag: "InvariantViolated", invariant: "heard below 20" })
    expect(found.error.reproduces).toBe(true)

    const opened = Replay.session(make, found.error.replay, { invariants: [HeardLow] })
    if (!opened.ok) throw new Error(JSON.stringify(opened.error))
    const played = opened.value.play()
    expect(played.data.run.stop).toMatchObject({ reason: "invariant", invariant: "heard below 20" })
    expect(played.data.run.range?.[1]).toBe(found.error.frame)
    expect(played.data.checkpoints._tag).toBe("Compared")
  })

  it("do not see what setup left in flight", () => {
    // Only setup's 100 could reach 100 within a few frames of dx at most 2.
    const found = Fuzz.run(make, { schedule: "events", setup: "setup", inputs: [Dx], invariants: [heardBelow(100)], frames: 10, runs: 3, seed: 1 })
    expect(found.ok).toBe(true)
  })
})
