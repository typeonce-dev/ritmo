import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import type { ExecutableScheduleDefinition } from "@typeonce/ritmo/Schedule"

const hostClock = HostClock.test()

const Position = Descriptor.Component<number>()("TickQuery/Position")
const Enemy = Descriptor.Component<{}>()("TickQuery/Enemy")
const Game = Schema.bind(Schema.fragment({ components: { Position, Enemy } }))
const Flow = Game.StateMachine("TickQuery/Flow", ["Menu", "Playing"])

const Enemies = Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Enemy] })
const SpawnWave = Game.System("TickQuery/SpawnWave", {
  commands: Game.System.commands(Game.System.spawns(Position, Enemy))
}, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Position, 1], [Enemy, {}]))
})
const seen: Array<number> = []
const Aim = Game.System("TickQuery/Aim", { queries: { enemies: Game.System.thisTick(Enemies) } }, ({ queries }) => {
  seen.push(queries.enemies.each().length)
})

/** Erases a schedule's type, as plugin boundaries and devtools do. */
const erased = (schedule: ExecutableScheduleDefinition<any, any, any, any, any, any>): ExecutableScheduleDefinition<typeof Game.schema, never, typeof Game.schema> =>
  schedule as ExecutableScheduleDefinition<typeof Game.schema, never, typeof Game.schema>

const machines = Game.Runtime.machines(Game.Runtime.machine(Flow, "Menu"))
const make = () => Game.Runtime.make({ services: Game.Runtime.services(), machines }).success
const makeDebug = () => Game.Runtime.make({ services: Game.Runtime.services(), machines, debug: { hostClock } }).success

const unflushed = "TickQuery/Aim needs this tick's commands for queries.enemies, but TickQuery/SpawnWave queues them with no applyDeferred() in between: add Game.Schedule.applyDeferred() after TickQuery/SpawnWave"
const late = "TickQuery/SpawnWave queues commands that TickQuery/Aim needs this tick (queries.enemies), but it runs after TickQuery/Aim: move TickQuery/SpawnWave before the applyDeferred() that precedes TickQuery/Aim, or read queries.enemies without thisTick"

describe("thisTick on queries at runtime", () => {
  it("lets tryTick run a reader after the writer and a marker; the reader sees the spawn", () => {
    const runtime = make()
    seen.length = 0
    expect(runtime.tryTick(erased(Game.Schedule(SpawnWave, Game.Schedule.applyDeferred(), Aim)))._tag).toBe("Success")
    expect(seen).toEqual([1])
  })

  it("makes tryTick fail, running nothing, for a writer with no marker before the reader", () => {
    const runtime = make()
    seen.length = 0
    expect(runtime.tryTick(erased(Game.Schedule(SpawnWave, Aim)))).toEqual({
      _tag: "Failure",
      failure: {
        _tag: "TickOrderViolation",
        issues: [{ kind: "unflushedWriter", reader: "TickQuery/Aim", data: "queries.enemies", writer: "TickQuery/SpawnWave", message: unflushed }]
      }
    })
    expect(seen).toEqual([])
  })

  it("makes tryTick fail for a writer after the reader", () => {
    const runtime = make()
    const result = runtime.tryTick(erased(Game.Schedule(Aim, Game.Schedule.applyDeferred(), SpawnWave)))
    expect(result._tag === "Success" ? [] : result.failure._tag === "TickOrderViolation" ? result.failure.issues.map((issue) => issue.message) : []).toEqual([late])
  })

  it("counts a transition bundle at its marker: its flush, then its schedules", () => {
    const runtime = make()
    const spawnOnEnter = Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [SpawnWave]))
    const result = runtime.tryTick(erased(Game.Schedule(Game.Schedule.applyStateTransitions(spawnOnEnter), Aim)))
    expect(result._tag === "Success" ? [] : result.failure._tag === "TickOrderViolation" ? result.failure.issues.map((issue) => issue.message) : []).toEqual([unflushed])
    const aimOnEnter = Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [Aim]))
    expect(runtime.tryTick(erased(Game.Schedule(SpawnWave, Game.Schedule.applyStateTransitions(aimOnEnter))))._tag).toBe("Success")
  })

  it("reports this-tick-order lints for query reads, and none when ordered", () => {
    const runtime = makeDebug()
    runtime.debug.nameSchedules({
      wrong: erased(Game.Schedule(SpawnWave, Aim)),
      right: erased(Game.Schedule(SpawnWave, Game.Schedule.applyDeferred(), Aim))
    })
    const described = runtime.debug.describe()
    expect(described.lints.filter((lint) => lint.code === "this-tick-order").map((lint) => lint.message)).toEqual([`in wrong, ${unflushed}`])
    expect(described.systems.find((system) => system.name === "TickQuery/Aim")?.thisTick).toEqual(["queries.enemies"])
  })
})
