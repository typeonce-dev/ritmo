import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { Collector, recentSchedule, recentSystem } from "@typeonce/ritmo-devtools/Monitor"

const hostClock = HostClock.test()

const Position = Descriptor.Component<{ readonly x: number }>()("Mon/Position")
const Shot = Descriptor.Component<{ readonly speed: number }>()("Mon/Shot")
const Hit = Descriptor.Event<number>()("Mon/Hit")
const Paused = Descriptor.Resource<boolean>()("Mon/Paused")
const Game = Schema.bind(Schema.fragment({ components: { Position, Shot }, events: { Hit }, resources: { Paused } }))

const Movers = Game.Query({ selection: { position: Game.Query.write(Position) } })
const Move = Game.System("Mon/Move", { queries: { movers: Movers }, events: { hit: Game.System.writeEvent(Hit) } }, ({ queries, events }) => {
  for (const { data } of queries.movers.each()) data.position.update((position) => ({ x: position.x + 1 }))
  events.hit.emit(1)
})
const Fire = Game.System("Mon/Fire", { commands: Game.System.commands(Game.System.spawns(Shot)) }, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Shot, { speed: Number.NaN }]))
})
const Spawn = Game.System("Mon/Spawn", { commands: Game.System.commands(Game.System.spawns(Position)) }, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Position, { x: 0 }]))
})
const paused = Game.Condition.check("paused", { resources: { paused: Game.System.readResource(Paused) } }, ({ resources }) => resources.paused.get())
const Idle = Game.System("Mon/Idle", { when: [paused] }, () => {})

const setup = () => {
  const runtime = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Paused: false }, debug: { hostClock } }).success
  const update = Game.Schedule(Move, Fire, Idle, Game.Schedule.applyDeferred())
  runtime.debug.nameSchedules({ update })
  runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
  let now = 0
  const collector = new Collector(() => runtime.debug.population(), () => now)
  const stop = runtime.debug.observe(collector.observe)
  const run = (frames: number) => {
    for (let index = 0; index < frames; index++) runtime.tick(update)
    now += 250
    return collector.sample(now)
  }
  return { runtime, collector, run, stop }
}

describe("Monitor collector", () => {
  it("folds a window of trace events into per-system and per-schedule counts", () => {
    const { run } = setup()
    const sample = run(3)
    expect(sample.seconds).toBe(0.25)
    expect(sample.schedules.get("update")).toMatchObject({ ticks: 3 })
    expect(sample.systems.get("Mon/Move")).toMatchObject({ runs: 3, writes: 3, events: 3, skips: 0 })
    expect(sample.systems.get("Mon/Fire")).toMatchObject({ runs: 3, commands: 3, spawns: 3 })
    expect(sample.systems.get("Mon/Idle")).toMatchObject({ runs: 0, skips: 3 })
    expect(sample.population).toEqual({ entities: 4, components: { "Mon/Position": 1, "Mon/Shot": 3 } })

    const next = run(1)
    expect(next.systems.get("Mon/Move")).toMatchObject({ runs: 1 })
    expect(recentSystem([sample, next], "Mon/Move", 8)).toMatchObject({ runs: 4, writes: 4, seconds: 0.5 })
    expect(recentSchedule([sample, next], "update", 1)).toMatchObject({ ticks: 1 })
  })

  it("learns what systems spawn and labels it by the components only they spawn", () => {
    const { collector, run } = setup()
    run(2)
    expect(collector.spawnsOf("Mon/Fire")).toEqual([{ components: ["Mon/Shot"], count: 2 }])
    expect(collector.spawnNames("Mon/Fire", () => 0)).toEqual(["Mon/Shot"])
    expect(collector.spawnNames("Mon/Move", () => 0)).toEqual([])
    expect(collector.skippedBy.get("Mon/Idle")).toBe("check(paused)")
  })

  it("raises alerts for non-finite values", () => {
    const { collector, run } = setup()
    run(2)
    expect([...collector.alerts.values()]).toEqual([
      { code: "non-finite-value", message: "Mon/Fire wrote NaN or an infinity to e2 Mon/Shot.speed", count: 2, firstFrame: 2, lastFrame: 3 }
    ])
  })

  it("follows the selected entity's changes only", () => {
    const { collector, run } = setup()
    collector.select(1)
    run(2)
    expect(collector.entityLines.map((line) => `${line.system}: ${line.text}`)).toEqual([
      "Mon/Move: Mon/Position {x:0} -> {x:1}",
      "Mon/Move: Mon/Position {x:1} -> {x:2}"
    ])
    collector.select(undefined)
    expect(collector.entityLines).toEqual([])
  })
})
