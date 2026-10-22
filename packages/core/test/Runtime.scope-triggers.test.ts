import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import type * as Debug from "@typeonce/ritmo/Debug"

const Name = Descriptor.Component<string>()("ScopeTriggers/Name")
const Player = Descriptor.Component<{}>()("ScopeTriggers/Player")
const Game = Schema.bind(Schema.fragment({
  components: { Name, Player },
  requires: [Schema.requires(Player, Name)]
}))
const Flow = Game.StateMachine("ScopeTriggers/Flow", ["Menu", "Playing", "Paused"] as const)
const Run = Game.EntityScope("ScopeTriggers/Run", { despawnOnExit: [Flow, "Playing"] })
const Overlay = Game.EntityScope("ScopeTriggers/Overlay", { despawnOnEnter: [Flow, "Menu"] })

const makeRuntime = () => Game.Runtime.make({
  services: Game.Runtime.services(),
  machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Menu")),
  debug: { hostClock: HostClock.test() }
}).success

const Names = Game.Inspector("ScopeTriggers/Names", {
  queries: { named: Game.Query({ selection: { name: Game.Query.read(Name) } }) }
}, ({ queries }) => queries.named.each().map((match) => match.data.name.get()).sort())

const seenOnExit: Array<Array<string>> = []
const ObserveOnExit = Game.System("ScopeTriggers/ObserveOnExit", {
  queries: { named: Game.Query({ selection: { name: Game.Query.read(Name) } }) }
}, ({ queries }) => {
  seenOnExit.push(queries.named.each().map((match) => match.data.name.get()).sort())
})

const SpawnRun = Game.System("ScopeTriggers/SpawnRun", { commands: Game.System.commands(Game.System.spawns(Player)) }, ({ commands }) => {
  commands.spawnIn(Run, Game.Command.spawn([Player, {}], [Name, "player"]))
  commands.spawnIn(Overlay, Game.Command.spawn([Name, "hud"]))
})

const despawned: Array<number> = []
const ReadDespawned = Game.System("ScopeTriggers/ReadDespawned", {
  despawned: { entities: Game.System.readDespawned() }
}, ({ despawned: read }) => {
  despawned.push(read.entities.all().length)
})

const goTo = (state: "Menu" | "Playing" | "Paused") => Game.System(`ScopeTriggers/GoTo${state}`, {
  nextMachines: { flow: Game.System.nextState(Flow) }
}, ({ nextMachines }) => {
  nextMachines.flow.set(state)
})

const transitions = Game.Schedule.transitions(
  Game.Schedule.onEnter(Flow, "Playing", [SpawnRun, Game.Schedule.applyDeferred()]),
  Game.Schedule.onExit(Flow, "Playing", [ObserveOnExit])
)

describe("entity scopes despawned by state transitions", () => {
  it("despawns on exit after onExit ran, keeps onEnter spawns, and traces it", () => {
    const runtime = makeRuntime()
    const events: Array<Debug.TraceEvent> = []
    runtime.debug.observe((event) => events.push(event))

    // Menu -> Playing: onEnter spawns into Run and Overlay; nothing despawned.
    runtime.tick(Game.Schedule(goTo("Playing"), Game.Schedule.applyStateTransitions(transitions)))
    expect(runtime.inspect(Names)).toEqual(["hud", "player"])

    // Playing -> Paused: Run despawned (exit Playing) as whole entities, so no
    // requirement breaks; onExit still saw it.
    runtime.tick(Game.Schedule(goTo("Paused"), Game.Schedule.applyStateTransitions(transitions), ReadDespawned))
    expect(seenOnExit).toEqual([["hud", "player"]])
    expect(runtime.inspect(Names)).toEqual(["hud"])
    expect(despawned).toEqual([1])

    // Paused -> Menu: Overlay despawned (enter Menu).
    runtime.tick(Game.Schedule(goTo("Menu"), Game.Schedule.applyStateTransitions(transitions)))
    expect(runtime.inspect(Names)).toEqual([])

    // Menu -> Playing again: the fresh run survives.
    runtime.tick(Game.Schedule(goTo("Playing"), Game.Schedule.applyStateTransitions(transitions)))
    expect(runtime.inspect(Names)).toEqual(["hud", "player"])

    const scopeCommands = events.flatMap((event) =>
      event.type === "deferred" ? event.commands.filter((command) => command.tag.startsWith("despawnScope")) : []
    )
    expect(scopeCommands.map((command) => `${command.system}: ${command.tag} (${command.effects.length} effects)`)).toEqual([
      "onExit(ScopeTriggers/Flow=Playing): despawnScope ScopeTriggers/Run (1 effects)",
      "onEnter(ScopeTriggers/Flow=Menu): despawnScope ScopeTriggers/Overlay (1 effects)"
    ])
    expect(runtime.debug.describe().lints.filter((lint) => lint.code === "requirement-violated")).toEqual([])
  })

  it("does not despawn what an onExit system queued without applying it", () => {
    const SpawnOnExit = Game.System("ScopeTriggers/SpawnOnExit", { commands: Game.System.commands(Game.System.spawns(Name)) }, ({ commands }) => {
      commands.spawnIn(Run, Game.Command.spawn([Name, "late"]))
    })
    const lateTransitions = Game.Schedule.transitions(Game.Schedule.onExit(Flow, "Playing", [SpawnOnExit]))
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(goTo("Playing"), Game.Schedule.applyStateTransitions(lateTransitions)))
    runtime.tick(Game.Schedule(goTo("Menu"), Game.Schedule.applyStateTransitions(lateTransitions), Game.Schedule.applyDeferred()))
    expect(runtime.inspect(Names)).toEqual(["late"])
  })

  it("describes scope triggers and lints one that can never fire", () => {
    const scopeLints = (runtime: { readonly debug: { readonly describe: () => Debug.Description } }) =>
      runtime.debug.describe().lints.filter((lint) => lint.code === "scope-trigger-never-applied").map((lint) => lint.message)

    const unprovided = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.test() } }).success
    expect(unprovided.debug.describe().scopes).toEqual([
      { name: "ScopeTriggers/Run", despawnOn: ["onExit(ScopeTriggers/Flow=Playing)"] },
      { name: "ScopeTriggers/Overlay", despawnOn: ["onEnter(ScopeTriggers/Flow=Menu)"] }
    ])
    expect(scopeLints(unprovided)).toEqual([
      "ScopeTriggers/Run is despawned on onExit(ScopeTriggers/Flow=Playing), but the runtime does not provide ScopeTriggers/Flow, so its state never changes and the scope is never despawned",
      "ScopeTriggers/Overlay is despawned on onEnter(ScopeTriggers/Flow=Menu), but the runtime does not provide ScopeTriggers/Flow, so its state never changes and the scope is never despawned"
    ])

    const noMarker = makeRuntime()
    noMarker.debug.nameSchedules({ update: Game.Schedule(goTo("Playing")) })
    expect(scopeLints(noMarker)).toEqual([
      "ScopeTriggers/Run is despawned on onExit(ScopeTriggers/Flow=Playing), but no described schedule has an applyStateTransitions() marker, so the scope is never despawned",
      "ScopeTriggers/Overlay is despawned on onEnter(ScopeTriggers/Flow=Menu), but no described schedule has an applyStateTransitions() marker, so the scope is never despawned"
    ])

    const noQueuer = makeRuntime()
    noQueuer.debug.nameSchedules({ update: Game.Schedule(ObserveOnExit, Game.Schedule.applyStateTransitions(transitions)) })
    expect(scopeLints(noQueuer)[0]).toBe(
      "ScopeTriggers/Run is despawned on onExit(ScopeTriggers/Flow=Playing), but no described system queues a next state of ScopeTriggers/Flow, so the scope is never despawned"
    )

    const applied = makeRuntime()
    applied.debug.nameSchedules({ update: Game.Schedule(goTo("Playing"), Game.Schedule.applyStateTransitions(transitions)) })
    expect(scopeLints(applied)).toEqual([])
  })

  it("rejects a duplicate scope name", () => {
    expect(() => Game.EntityScope("ScopeTriggers/Run")).toThrow("Duplicate entity scope name: ScopeTriggers/Run")
  })
})
