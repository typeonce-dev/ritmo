import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { Clock, Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import * as Codecs from "../../core/test/codecs.ts"
import type * as Schedule from "@typeonce/ritmo/Schedule"
import { Invariant, Replay } from "@typeonce/ritmo-devtools"
import { worldOf } from "../../core/test/saved.ts"

const hostClock = HostClock.test()

const Position = Descriptor.ConstructedComponent(Codecs.struct({ x: Codecs.number }))("Replay/Position")
const Steps = Descriptor.ConstructedResource(Codecs.number)("Replay/Steps")
const Bump = Descriptor.Event<number>()("Replay/Bump")
const Input = Descriptor.Service<Schedule.Source<{ readonly dx: number }>>()("Replay/Input")
const Config = Descriptor.Service<{ readonly scale: number }>()("Replay/Config")
const Game = Schema.bind(Schema.fragment({ components: { Position }, resources: { Steps }, events: { Bump } }))

const Spawn = Game.System("Replay/Spawn", { commands: Game.System.commands(Game.System.spawns(Position)) }, ({ commands }) => {
  const draft = Game.Command.spawn(Game.Command.entryRaw(Position, { x: 0 }))
  if (draft.ok) commands.spawn(draft.value)
})
const Move = Game.System("Replay/Move", {
  queries: { movers: Game.Query({ selection: { position: Game.Query.write(Position) } }) },
  resources: { steps: Game.System.writeResource(Steps) },
  events: { bump: Game.System.readEvent(Bump) },
  services: { input: Game.System.service(Input), config: Game.System.service(Config) }
}, ({ queries, resources, events, services }) => {
  const dx = services.input.snapshot().dx * services.config.scale + events.bump.all().reduce((total, bump) => total + bump, 0)
  for (const { data } of queries.movers.each()) data.position.setRaw({ x: data.position.get().x + dx })
  resources.steps.update((steps) => steps + 1)
})
const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
const update = Game.Schedule(Move)

const FarAway = Invariant.fromInspector(Game.Inspector("far away", {
  queries: { movers: Game.Query({ selection: { position: Game.Query.read(Position) } }) }
}, ({ queries }) => queries.movers.each().some(({ data }) => data.position.get().x > 20) ? "x above 20" : undefined))

/** A live game whose input is a scripted list of dx values, one per tick. */
const live = (dxs: ReadonlyArray<number>) => {
  let index = 0
  const input: Schedule.Source<{ readonly dx: number }> = { snapshot: () => ({ dx: dxs[index++] ?? 0 }) }
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Input, input), Game.Runtime.service(Config, { scale: 2 })),
    resources: { Steps: 0 },
    debug: { hostClock }
  })
  if (!made.ok) throw new Error("fixture")
  made.value.tick(setup)
  return made.value
}

/** The game built for a replay: the recorded input instead of the live one. */
const make = (playback: Replay.Playback) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Input, playback.source(Input)), Game.Runtime.service(Config, { scale: 2 })),
    resources: { Steps: 0 },
    debug: { hostClock }
  })
  if (!made.ok) throw new Error("fixture")
  return { runtime: made.value, schedules: { update }, hostClock }
}

const record = (dxs: ReadonlyArray<number>, options: { readonly keep?: number; readonly every?: number } = {}) => {
  const runtime = live(dxs)
  const sink = Replay.memorySink()
  // savedAt reads the recorder's clock: a test clock moved to 1000 ms.
  const savedClock = HostClock.test()
  savedClock.adjust(1_000)
  const recorder = Replay.recorder(runtime, { schedule: update, name: "update", keep: options.keep ?? 10, step: Clock.hz(1), every: options.every ?? 2, sink, hostClock: savedClock })
  return { runtime, sink, recorder }
}

const positionOf = (snapshot: { readonly entities: ReadonlyArray<{ readonly components: Readonly<Record<string, unknown>> }> }) =>
  snapshot.entities[0]?.components[Position.name]

describe("Replay", () => {
  it("records the window and replays it to the same world", () => {
    const { runtime, recorder } = record([1, 2, 3, 0, 0, 5])
    for (let step = 0; step < 6; step++) runtime.tick(update)
    runtime.send(Bump, 10)
    runtime.tick(update)
    const file = recorder.save("test")
    expect(file).toMatchObject({ format: "ritmo-replay", version: 1, library: Replay.version, schedule: "update", reason: "test", savedAt: 1_000, constants: { "Replay/Config": { scale: 2 } } })
    expect(file.ticks.find((record) => record.tick === 7)?.sent).toEqual([{ event: "Replay/Bump", value: 10 }])
    // Repeated input is stored once: ticks 4 and 5 both read dx 0, and tick 7 reads the default 0 again.
    expect(file.ticks.find((record) => record.tick === 5)?.services).toBeUndefined()

    const opened = Replay.session(make, file)
    if (!opened.ok) throw new Error(JSON.stringify(opened.error))
    const played = opened.value.play()
    expect(played.data.diverged).toEqual([])
    expect(played.text).toContain("checkpoints match")
    expect(positionOf(worldOf(opened.value.snapshot()))).toEqual(positionOf(worldOf(runtime.snapshot())))
    expect(positionOf(worldOf(opened.value.snapshot()))).toEqual({ x: (1 + 2 + 3 + 5) * 2 + 10 })
  })

  it("names entities with labels in the replay session", () => {
    const { runtime, recorder } = record([1, 2])
    for (let step = 0; step < 2; step++) runtime.tick(update)
    const Labels = Game.Inspector("labels", {
      queries: { movers: Game.Query({ selection: { position: Game.Query.read(Position) } }) }
    }, ({ queries }) => new Map(queries.movers.each().map((match) => [match.entity.id, "mover"] as const)))
    const opened = Replay.session(make, recorder.save("labels"), { labels: Labels })
    if (!opened.ok) throw new Error(JSON.stringify(opened.error))
    opened.value.play()
    expect(opened.value.session.why(1, Position).text.split("\n")[0]).toBe("mover e1 Replay/Position is now {x:6}; last 2 changes (oldest first):")
  })

  it("keeps only the last seconds, from the newest snapshot before them", () => {
    const { runtime, recorder } = record(Array.from({ length: 20 }, () => 1), { keep: 4, every: 2 })
    for (let step = 0; step < 20; step++) runtime.tick(update)
    const file = recorder.save("window")
    expect(file.start.tick).toBe(16)
    expect(file.ticks.map((record) => record.tick)).toEqual([17, 18, 19, 20])
    // The input never changed after tick 1, yet the window carries it.
    expect(file.ticks[0]!.services).toEqual({ "Replay/Input": [{ dx: 1 }] })
    const opened = Replay.session(make, file)
    if (!opened.ok) throw new Error(JSON.stringify(opened.error))
    const played = opened.value.play()
    expect(played.data.run.stop).toEqual({ reason: "completed" })
    expect(played.data.diverged).toEqual([])
  })

  it("is a session: why and journal explain the replayed ticks", () => {
    const { runtime, recorder } = record([1, 1, 1])
    for (let step = 0; step < 3; step++) runtime.tick(update)
    const opened = Replay.session(make, recorder.save("explain"))
    if (!opened.ok) throw new Error("open")
    opened.value.play()
    expect(opened.value.session.whyResource(Steps).text).toContain("Replay/Move")
  })

  it("finds nondeterminism by replaying twice", () => {
    const { runtime, recorder } = record([1, 1, 1, 1])
    for (let step = 0; step < 4; step++) runtime.tick(update)
    const file = recorder.save("nondeterministic")
    expect(Replay.verify(make, file)).toMatchObject({ ok: true, value: { data: { deterministic: true, diverged: [] } } })

    let calls = 0
    const Noise = Game.System("Replay/Noise", { resources: { steps: Game.System.writeResource(Steps) } }, ({ resources }) => {
      // Something the replay does not hold: a counter outside the world, like Math.random or wall time.
      calls += 1
      resources.steps.set(calls)
    })
    const noisy = (playback: Replay.Playback) => ({ ...make(playback), schedules: { update: Game.Schedule(Move, Noise) } })
    const verdict = Replay.verify(noisy, file)
    expect(verdict.ok && verdict.value.data.deterministic).toBe(false)
  })

  it("extracts a range into a small replay that plays from its own start", () => {
    const { runtime, recorder } = record([1, 2, 3, 4, 5, 6])
    for (let step = 0; step < 6; step++) runtime.tick(update)
    const file = recorder.save("extract")
    const extracted = Replay.extract(make, file, { from: 4, to: 5 })
    if (!extracted.ok) throw new Error("extract")
    expect(extracted.value.start.tick).toBe(3)
    expect(positionOf(extracted.value.start.snapshot)).toEqual({ x: (1 + 2 + 3) * 2 })
    expect(extracted.value.ticks.map((record) => record.tick)).toEqual([4, 5])
    const opened = Replay.session(make, JSON.parse(JSON.stringify(extracted.value)))
    if (!opened.ok) throw new Error("open extract")
    expect(opened.value.play().data.diverged).toEqual([])
    expect(positionOf(worldOf(opened.value.snapshot()))).toEqual({ x: (1 + 2 + 3 + 4 + 5) * 2 })
  })

  it("rejects a replay recorded with another schema, and data that is not a replay", () => {
    const { runtime, recorder } = record([1])
    runtime.tick(update)
    const file = recorder.save("schema")
    expect(Replay.session(make, { ...file, schema: "00000000" })).toMatchObject({ ok: false, error: { _tag: "SchemaMismatch", message: "replay recorded with an older schema" } })
    expect(Replay.parse({ format: "other" })).toMatchObject({ ok: false, error: { _tag: "InvalidReplay" } })
    expect(Replay.parse(JSON.parse(JSON.stringify(file))).ok).toBe(true)
  })

  it("saves by itself when an invariant breaks, once until it holds again, and when a tick fails", () => {
    const runtime = live([5, 5, 5, 5, 5])
    const sink = Replay.memorySink()
    Replay.recorder(runtime, { schedule: update, name: "update", keep: 10, step: Clock.hz(1), sink, hostClock, saveOn: { invariants: [FarAway] } })
    for (let step = 0; step < 5; step++) runtime.tick(update)
    expect(sink.files.map((file) => file.reason)).toEqual(["invariant far away broke at tick 3: x above 20"])

    const failing = Game.Schedule(Game.System("Replay/Fail", {}, () => Result.failure("Broken" as const)))
    const failures = Replay.memorySink()
    const quiet = live([])
    Replay.recorder(quiet, { schedule: failing, name: "failing", keep: 10, step: Clock.hz(1), sink: failures, hostClock, saveOn: { failure: true } })
    quiet.tick(failing)
    expect(failures.files.map((file) => file.reason)).toEqual([`tick 1 failed: Replay/Fail returned "Broken"`])
  })

  it("stops recording and gives the services back their own snapshot", () => {
    const runtime = live([1])
    const before = runtime.services["Replay/Input"].snapshot
    const recorder = Replay.recorder(runtime, { schedule: update, name: "update", keep: 10, step: Clock.hz(1), sink: Replay.memorySink(), hostClock })
    expect(runtime.services["Replay/Input"].snapshot).not.toBe(before)
    recorder.stop()
    expect(runtime.services["Replay/Input"].snapshot).toBe(before)
  })

  it("writes the package's version into replays", () => {
    const pkg: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    expect(typeof pkg === "object" && pkg !== null && "version" in pkg ? pkg.version : undefined).toBe(Replay.version)
  })
})
