import { describe, expect, it } from "vitest"
import { Debug, Descriptor, HostClock, Result, Schema, Snapshot } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"

const Health = Descriptor.Component<number>()("Numbers/Health")
const Speed = Descriptor.ConstructedComponent(Codecs.number)("Numbers/Speed")
const Shield = Descriptor.Component<number>()("Numbers/Shield")
const Target = Descriptor.Component<number | { readonly x: number }>()("Numbers/Target")
const Label = Descriptor.ConstructedComponent(Codecs.string)("Numbers/Label")
const Game = Schema.bind(Schema.fragment({ components: { Health, Speed, Shield, Target, Label } }))
const Flow = Game.StateMachine("Numbers/Flow", { Playing: {}, Menu: {} })

const makeRuntime = (debug = false) => Game.Runtime.make({
  services: Game.Runtime.services(),
  machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "Playing" })),
  ...(debug ? { debug: { hostClock: HostClock.test() } } : {})
}).value

const Speeds = Game.Query({ selection: { speed: Game.Query.write(Speed) } })

const spawner = (count: number) =>
  Game.System("Numbers/Spawn", { commands: Game.System.commands(Game.System.spawns(Speed, Label)) }, ({ commands }) => {
    for (let index = 0; index < count; index++) {
      commands.spawn(Game.Command.spawn([Speed, index], [Label, `n${index}`]))
    }
  })

const AllSpeeds = Game.Inspector("Numbers/AllSpeeds", {
  queries: { all: Game.Query({ selection: { speed: Game.Query.read(Speed) } }) }
}, ({ queries }) => queries.all.each().map((match) => match.data.speed.get()))

describe("number values", () => {
  it("validate raw input through the component's codec", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawner(1), Game.Schedule.applyDeferred()))
    const results: Array<boolean> = []
    const Raw = Game.System("Numbers/Raw", { queries: { all: Speeds } }, ({ queries }) => {
      for (const { data } of queries.all.each()) {
        results.push(data.speed.setRaw(4).ok, data.speed.setRaw(Number.POSITIVE_INFINITY).ok)
        results.push(data.speed.updateRaw((speed) => speed + 1).ok)
      }
    })
    runtime.tick(Game.Schedule(Raw))
    expect(results).toEqual([true, false, true])
    expect(runtime.inspect(AllSpeeds)).toEqual([5])
  })

  it("read an optional number as the number or undefined", () => {
    const runtime = makeRuntime()
    const seen: Array<number | undefined> = []
    const Spawn = Game.System("Numbers/SpawnShield", { commands: Game.System.commands(Game.System.spawns(Speed, Shield)) }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Speed, 1], [Shield, 3]))
      commands.spawn(Game.Command.spawn([Speed, 2]))
    })
    const Read = Game.System("Numbers/ReadShield", {
      queries: { all: Game.Query({ selection: { speed: Game.Query.read(Speed), shield: Game.Query.optional(Shield) } }) }
    }, ({ queries }) => {
      for (const { data } of queries.all.each()) seen.push(data.shield?.get())
    })
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), Read))
    expect(seen).toEqual([3, undefined])
  })

  it("roll a transition phase back with its change ticks", () => {
    const runtime = makeRuntime()
    const seen: Array<Array<number>> = []
    const Slow = Game.System("Numbers/Slow", { queries: { all: Speeds } }, ({ queries }) => {
      for (const { data } of queries.all.each()) data.speed.set(data.speed.get() + 100)
    })
    const Fail = Game.System("Numbers/Fail", {}, () => Result.failure("busy"))
    const Watch = Game.System("Numbers/Watch", {
      queries: { changed: Game.Query({ selection: { speed: Game.Query.read(Speed) }, filters: [Game.Query.changed(Speed)] }) }
    }, ({ queries }) => {
      seen.push(queries.changed.each().map((match) => match.data.speed.get()))
    })
    const transitions = Game.Schedule.transitions(
      Game.Schedule.onExit(Flow, "Playing", [Slow]),
      Game.Schedule.onTransition(Flow, ["Playing", "Menu"], [Fail])
    )
    const ToMenu = Game.System("Numbers/ToMenu", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
      nextMachines.flow.set({ _tag: "Menu" })
    })
    runtime.tick(Game.Schedule(spawner(2), Game.Schedule.applyDeferred(), Watch))
    const failed = runtime.tick(Game.Schedule(ToMenu, Game.Schedule.applyStateTransitions(transitions)))
    runtime.tick(Game.Schedule(Watch))
    expect(failed.ok).toBe(false)
    expect(seen).toEqual([[0, 1], []])
    expect(runtime.inspect(AllSpeeds)).toEqual([0, 1])
  })

  it("round-trip through a snapshot", () => {
    // Every component validated on load, so the world can be saved.
    const Saved = Schema.bind(Schema.fragment({ components: { Speed, Label } }))
    const make = () => Saved.Runtime.make({ services: Saved.Runtime.services() }).value
    const Spawn = Saved.System("Numbers/SpawnSaved", { commands: Saved.System.commands(Saved.System.spawns(Speed, Label)) }, ({ commands }) => {
      for (let index = 0; index < 300; index++) commands.spawn(Saved.Command.spawn([Speed, index], [Label, `n${index}`]))
    })
    const Read = Saved.Inspector("Numbers/ReadSaved", {
      queries: { all: Saved.Query({ selection: { speed: Saved.Query.read(Speed) } }) }
    }, ({ queries }) => queries.all.each().map((match) => match.data.speed.get()))
    const source = make()
    source.tick(Saved.Schedule(Spawn, Saved.Schedule.applyDeferred()))
    const taken = source.snapshot()
    if (!taken.ok) throw new Error(taken.error._tag)
    const saved: unknown = JSON.parse(JSON.stringify(taken.value))
    const parsed = Snapshot.parse(saved)
    expect(parsed.ok ? parsed.value.entities[299] : parsed.error).toEqual({ id: 300, components: { "Numbers/Speed": 299, "Numbers/Label": "n299" } })
    const target = make()
    expect(target.restore(saved).ok).toBe(true)
    expect(target.inspect(Read)).toEqual(Array.from({ length: 300 }, (_, index) => index))
  })

  it("trace a changed number with its value before and after", () => {
    const runtime = makeRuntime(true)
    runtime.tick(Game.Schedule(spawner(2), Game.Schedule.applyDeferred()))
    const events: Array<Debug.TraceEvent> = []
    runtime.debug.observe((event) => events.push(event))
    // Entity 1 keeps its speed (an equal write is not a change); entity 2 doubles.
    const Double = Game.System("Numbers/Double", { queries: { all: Speeds } }, ({ queries }) => {
      for (const { data } of queries.all.each()) data.speed.set(data.speed.get() * 2)
    })
    runtime.tick(Game.Schedule(Double))
    const run = events.find((event): event is Debug.SystemEvent => event.type === "system")!
    expect(run.writes).toEqual([{ entity: 2, component: "Numbers/Speed", before: 1, after: 2 }])
  })

  it("keep a component whose value is sometimes a number, through commits, rollbacks, and phases", () => {
    const runtime = makeRuntime()
    const Targets = Game.Query({ selection: { target: Game.Query.write(Target) } })
    const AllTargets = Game.Inspector("Numbers/AllTargets", {
      queries: { all: Game.Query({ selection: { target: Game.Query.read(Target) } }) }
    }, ({ queries }) => queries.all.each().map((match) => match.data.target.get()))
    const changed: Array<number> = []
    const Watch = Game.System("Numbers/WatchTargets", {
      queries: { changed: Game.Query({ selection: { target: Game.Query.read(Target) }, filters: [Game.Query.changed(Target)] }) }
    }, ({ queries }) => {
      changed.push(queries.changed.each().length)
    })
    const Spawn = Game.System("Numbers/SpawnTargets", { commands: Game.System.commands(Game.System.spawns(Target)) }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Target, 1]))
      commands.spawn(Game.Command.spawn([Target, { x: 2 }]))
    })
    // Each value swaps kinds: the number becomes an object, the object a number.
    const Swap = Game.System("Numbers/Swap", { queries: { all: Targets } }, ({ queries }) => {
      for (const { data } of queries.all.each()) {
        const current = data.target.get()
        data.target.set(typeof current === "number" ? { x: current } : current.x)
      }
    })
    const SwapAndFail = Game.System("Numbers/SwapAndFail", { queries: { all: Targets } }, ({ queries }) => {
      for (const { data } of queries.all.each()) {
        const current = data.target.get()
        data.target.set(typeof current === "number" ? { x: current } : current.x)
      }
      return Result.failure("Rejected" as const)
    })
    // Writing the same number back is not a change.
    const Same = Game.System("Numbers/Same", { queries: { all: Targets } }, ({ queries }) => {
      for (const { data } of queries.all.each()) data.target.set(data.target.get())
    })
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), Watch))
    expect(runtime.inspect(AllTargets)).toEqual([1, { x: 2 }])
    runtime.tick(Game.Schedule(Swap, Watch))
    expect(runtime.inspect(AllTargets)).toEqual([{ x: 1 }, 2])
    expect(runtime.tick(Game.Schedule(SwapAndFail)).ok).toBe(false)
    expect(runtime.inspect(AllTargets)).toEqual([{ x: 1 }, 2])
    runtime.tick(Game.Schedule(Watch))
    const transitions = Game.Schedule.transitions(
      Game.Schedule.onExit(Flow, "Playing", [Swap]),
      Game.Schedule.onTransition(Flow, ["Playing", "Menu"], [Game.System("Numbers/FailPhase", {}, () => Result.failure("busy"))])
    )
    const ToMenu = Game.System("Numbers/ToMenu", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
      nextMachines.flow.set({ _tag: "Menu" })
    })
    expect(runtime.tick(Game.Schedule(ToMenu, Game.Schedule.applyStateTransitions(transitions))).ok).toBe(false)
    expect(runtime.inspect(AllTargets)).toEqual([{ x: 1 }, 2])
    runtime.tick(Game.Schedule(Watch))
    runtime.tick(Game.Schedule(Same, Watch))
    expect(changed).toEqual([2, 2, 0, 0, 0])
  })

  it("restore a number a run replaced with another value, and see no change when it writes the number back", () => {
    const runtime = makeRuntime()
    const Targets = Game.Query({ selection: { target: Game.Query.write(Target) } })
    const AllTargets = Game.Inspector("Numbers/RoundTripTargets", {
      queries: { all: Game.Query({ selection: { target: Game.Query.read(Target) } }) }
    }, ({ queries }) => queries.all.each().map((match) => match.data.target.get()))
    const changed: Array<number> = []
    const Watch = Game.System("Numbers/WatchRoundTrip", {
      queries: { changed: Game.Query({ selection: { target: Game.Query.read(Target) }, filters: [Game.Query.changed(Target)] }) }
    }, ({ queries }) => {
      changed.push(queries.changed.each().length)
    })
    const Spawn = Game.System("Numbers/SpawnRoundTrip", { commands: Game.System.commands(Game.System.spawns(Target)) }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Target, 1.5]))
    })
    const RoundTrip = Game.System("Numbers/RoundTrip", { queries: { all: Targets } }, ({ queries }) => {
      for (const { data } of queries.all.each()) {
        data.target.set({ x: 0 })
        data.target.set(1.5)
      }
    })
    const ReplaceAndFail = Game.System("Numbers/ReplaceAndFail", { queries: { all: Targets } }, ({ queries }) => {
      for (const { data } of queries.all.each()) data.target.set({ x: 0 })
      return Result.failure("Rejected" as const)
    })
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), Watch))
    runtime.tick(Game.Schedule(RoundTrip, Watch))
    expect(runtime.tick(Game.Schedule(ReplaceAndFail)).ok).toBe(false)
    runtime.tick(Game.Schedule(Watch))
    expect(changed).toEqual([1, 0, 0])
    expect(runtime.inspect(AllTargets)).toEqual([1.5])
  })

  it("count NaN written over NaN as no change", () => {
    const runtime = makeRuntime()
    const changed: Array<number> = []
    const Spawn = Game.System("Numbers/SpawnNaN", { commands: Game.System.commands(Game.System.spawns(Health)) }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Health, Number.NaN]))
    })
    const Rewrite = Game.System("Numbers/RewriteNaN", {
      queries: { all: Game.Query({ selection: { health: Game.Query.write(Health) } }) }
    }, ({ queries }) => {
      for (const { data } of queries.all.each()) data.health.set(Number.NaN)
    })
    const Watch = Game.System("Numbers/WatchNaN", {
      queries: { changed: Game.Query({ selection: { health: Game.Query.read(Health) }, filters: [Game.Query.changed(Health)] }) }
    }, ({ queries }) => {
      changed.push(queries.changed.each().length)
    })
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), Watch))
    runtime.tick(Game.Schedule(Rewrite, Watch))
    expect(changed).toEqual([1, 0])
  })
})
