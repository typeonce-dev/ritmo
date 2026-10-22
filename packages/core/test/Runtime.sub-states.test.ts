import { describe, expect, it } from "vitest"
import { Decode, Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import { worldOf } from "./world-of.ts"

const Name = Descriptor.ConstructedComponent(Decode.string)("SubStates/Name")
const Game = Schema.bind(Schema.fragment({ components: { Name } }))
const Session = Game.StateMachine("SubStates/Session", ["Menu", "Playing"] as const)
const Phase = Game.StateMachine("SubStates/Phase", ["Setup", "Battle"] as const, { within: [Session, "Playing"] })
const Turn = Game.StateMachine("SubStates/Turn", ["Mine", "Theirs"] as const, { within: [Phase, "Battle"] })
const Battlefield = Game.EntityScope("SubStates/Battlefield", { despawnOnExit: [Phase, "Battle"] })

const makeRuntime = (session: "Menu" | "Playing") => Game.Runtime.make({
  services: Game.Runtime.services(),
  machines: Game.Runtime.machines(
    Game.Runtime.machine(Session, session),
    Game.Runtime.machine(Phase, "Setup"),
    Game.Runtime.machine(Turn, "Mine")
  )
}).success

const log: Array<string> = []
const note = (label: string) => Game.System(`SubStates/${label}`, {}, () => { log.push(label) })

const Read = Game.System("SubStates/Read", {
  machines: { phase: Game.System.machine(Phase), turn: Game.System.machine(Turn) },
  transitionEvents: { phase: Game.System.readTransitionEvent(Phase) }
}, ({ machines, transitionEvents }) => {
  log.push(`phase=${String(machines.phase.get())} turn=${String(machines.turn.get())} events=${JSON.stringify(transitionEvents.phase.all())}`)
})

const InBattle = Game.Schedule.when([Game.Condition.inState(Phase, "Battle")], note("inBattle"))

const sets: Array<unknown> = []
const setPhase = (value: "Setup" | "Battle") => Game.System(`SubStates/Set${value}`, {
  nextMachines: { phase: Game.System.nextState(Phase) }
}, ({ nextMachines }) => {
  sets.push(nextMachines.phase.set(value))
})
const setSession = (value: "Menu" | "Playing") => Game.System(`SubStates/Session${value}`, {
  nextMachines: { session: Game.System.nextState(Session) }
}, ({ nextMachines }) => {
  nextMachines.session.set(value)
})

const SpawnBattlefield = Game.System("SubStates/SpawnBattlefield", { commands: Game.System.commands(Game.System.spawns(Name)) }, ({ commands }) => {
  commands.spawnIn(Battlefield, Game.Command.spawn([Name, "tile"]))
})
const Names = Game.Inspector("SubStates/Names", {
  queries: { named: Game.Query({ selection: { name: Game.Query.read(Name) } }) }
}, ({ queries }) => queries.named.each().length)

const transitions = Game.Schedule.transitions(
  Game.Schedule.onEnter(Session, "Playing", [note("enter Session=Playing")]),
  Game.Schedule.onExit(Session, "Playing", [note("exit Session=Playing")]),
  Game.Schedule.onEnter(Phase, "Setup", [note("enter Phase=Setup")]),
  Game.Schedule.onEnter(Phase, "Battle", [note("enter Phase=Battle"), SpawnBattlefield, Game.Schedule.applyDeferred()]),
  Game.Schedule.onExit(Phase, "Battle", [note("exit Phase=Battle")]),
  Game.Schedule.onEnter(Turn, "Mine", [note("enter Turn=Mine")]),
  Game.Schedule.onExit(Turn, "Mine", [note("exit Turn=Mine")])
)

describe("sub-states", () => {
  it("exist only while the parent is in their state, enter after the parent and exit before it", () => {
    log.length = 0
    sets.length = 0
    const runtime = makeRuntime("Menu")

    // Inactive at start: no value, inState false, set fails, and a system
    // reading it still runs (the machine is provided).
    expect(runtime.tick(Game.Schedule(Read, InBattle, setPhase("Battle"), Game.Schedule.applyStateTransitions(transitions)))._tag).toBe("Success")
    expect(log).toEqual(["phase=undefined turn=undefined events=[]"])
    expect(sets).toEqual([{ _tag: "Failure", failure: { _tag: "SubStateInactive", machine: "SubStates/Phase", parent: "SubStates/Session", requires: "Playing" } }])

    // Menu -> Playing: the parent enters first, then Phase enters its entry value.
    log.length = 0
    runtime.tick(Game.Schedule(setSession("Playing"), Game.Schedule.applyStateTransitions(transitions), Read))
    expect(log).toEqual([
      "enter Session=Playing",
      "enter Phase=Setup",
      "phase=Setup turn=undefined events=[{\"to\":\"Setup\"}]"
    ])

    // Setup -> Battle works now, spawns into the battlefield scope, and enters Turn.
    log.length = 0
    runtime.tick(Game.Schedule(setPhase("Battle"), Game.Schedule.applyStateTransitions(transitions), InBattle, Read))
    expect(sets.at(-1)).toEqual({ _tag: "Success", success: undefined })
    expect(log).toEqual([
      "enter Phase=Battle",
      "enter Turn=Mine",
      "inBattle",
      "phase=Battle turn=Mine events=[{\"from\":\"Setup\",\"to\":\"Battle\"}]"
    ])
    expect(runtime.inspect(Names)).toBe(1)

    // Playing -> Menu: Turn exits, then Phase (its scope despawned), then the
    // parent. A Phase change queued in the same marker is discarded.
    log.length = 0
    runtime.tick(Game.Schedule(setSession("Menu"), setPhase("Setup"), Game.Schedule.applyStateTransitions(transitions), Read, InBattle))
    expect(log).toEqual([
      "exit Turn=Mine",
      "exit Phase=Battle",
      "exit Session=Playing",
      "phase=undefined turn=undefined events=[{\"from\":\"Battle\"}]"
    ])
    expect(runtime.inspect(Names)).toBe(0)

    // Re-entering Playing restarts Phase at Setup.
    log.length = 0
    runtime.tick(Game.Schedule(setSession("Playing"), Game.Schedule.applyStateTransitions(transitions), Read))
    expect(log).toEqual([
      "enter Session=Playing",
      "enter Phase=Setup",
      "phase=Setup turn=undefined events=[{\"to\":\"Setup\"}]"
    ])
  })

  it("restarts when the parent sets the same state again, and stays with setIfChanged", () => {
    const runtime = makeRuntime("Playing")
    runtime.tick(Game.Schedule(setPhase("Battle"), Game.Schedule.applyStateTransitions(transitions), Read))
    const again = Game.System("SubStates/PlayingAgain", { nextMachines: { session: Game.System.nextState(Session) } }, ({ nextMachines }) => {
      nextMachines.session.setIfChanged("Playing")
    })
    log.length = 0
    runtime.tick(Game.Schedule(again, Game.Schedule.applyStateTransitions(transitions), Read))
    expect(log).toEqual(["phase=Battle turn=Mine events=[]"])

    log.length = 0
    runtime.tick(Game.Schedule(setSession("Playing"), Game.Schedule.applyStateTransitions(transitions), Read))
    expect(log).toEqual([
      "exit Turn=Mine",
      "exit Phase=Battle",
      "exit Session=Playing",
      "enter Session=Playing",
      "enter Phase=Setup",
      "phase=Setup turn=undefined events=[{\"from\":\"Battle\"},{\"to\":\"Setup\"}]"
    ])
  })

  it("keeps the parent transition queued when a sub-state's exit fails", () => {
    let fail = true
    const FailingExit = Game.System("SubStates/FailingExit", {}, () => fail ? Result.fail("not yet" as const) : Result.succeed(undefined))
    const failing = Game.Schedule.transitions(Game.Schedule.onExit(Phase, "Setup", [FailingExit]))
    const runtime = makeRuntime("Playing")
    log.length = 0
    expect(runtime.tryTick(Game.Schedule(setSession("Menu"), Game.Schedule.applyStateTransitions(failing), Read))._tag).toBe("Failure")
    fail = false
    runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(failing), Read))
    expect(log).toEqual(["phase=undefined turn=undefined events=[{\"from\":\"Setup\"}]"])
  })

  it("enters a sub-state even when an onEnter of its parent fails", () => {
    let fail = true
    const FailingEnter = Game.System("SubStates/FailingEnter", {}, () => fail ? Result.fail("not yet" as const) : Result.succeed(undefined))
    const failing = Game.Schedule.transitions(Game.Schedule.onEnter(Session, "Playing", [FailingEnter]))
    const runtime = makeRuntime("Menu")
    sets.length = 0
    log.length = 0
    expect(runtime.tryTick(Game.Schedule(setSession("Playing"), Game.Schedule.applyStateTransitions(failing)))._tag).toBe("Failure")
    fail = false
    // The parent is committed, so its sub-state exists with its entry value.
    runtime.tick(Game.Schedule(Read, setPhase("Battle"), Game.Schedule.applyStateTransitions(transitions)))
    runtime.tick(Game.Schedule(Read, InBattle))
    expect(sets).toEqual([{ _tag: "Success", success: undefined }])
    expect(log).toEqual([
      "phase=Setup turn=undefined events=[{\"to\":\"Setup\"}]",
      "enter Phase=Battle",
      "enter Turn=Mine",
      "phase=Battle turn=Mine events=[{\"from\":\"Setup\",\"to\":\"Battle\"}]",
      "inBattle"
    ])
  })

  it("lets a parent's onEnter spawn into a scope its sub-state despawns on enter", () => {
    const Lobby = Game.EntityScope("SubStates/Lobby", { despawnOnEnter: [Phase, "Setup"] })
    const SpawnLobby = Game.System("SubStates/SpawnLobby", { commands: Game.System.commands(Game.System.spawns(Name)) }, ({ commands }) => {
      commands.spawnIn(Lobby, Game.Command.spawn([Name, "seat"]))
    })
    const bundle = Game.Schedule.transitions(Game.Schedule.onEnter(Session, "Playing", [SpawnLobby, Game.Schedule.applyDeferred()]))
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      machines: Game.Runtime.machines(Game.Runtime.machine(Session, "Menu"), Game.Runtime.machine(Phase, "Setup"), Game.Runtime.machine(Turn, "Mine"))
    }).success
    runtime.tick(Game.Schedule(setSession("Playing"), Game.Schedule.applyStateTransitions(bundle)))
    // The sub-state enters together with its parent, before the parent's onEnter, so the spawn survives.
    expect(runtime.inspect(Names)).toBe(1)
  })

  it("saves no value for an inactive sub-state and restores into either side", () => {
    const playing = makeRuntime("Playing")
    playing.tick(Game.Schedule(setPhase("Battle"), Game.Schedule.applyStateTransitions(transitions)))
    const battle = worldOf(playing.snapshot())
    expect(battle.machines).toEqual({ "SubStates/Session": "Playing", "SubStates/Phase": "Battle", "SubStates/Turn": "Mine" })

    const menu = makeRuntime("Menu")
    const atMenu = worldOf(menu.snapshot())
    expect(atMenu.machines).toEqual({ "SubStates/Session": "Menu" })

    // Restoring the menu save into a playing runtime clears the sub-states.
    expect(playing.restore(atMenu)).toEqual({ _tag: "Success", success: undefined })
    log.length = 0
    playing.tick(Game.Schedule(Read))
    expect(log).toEqual(["phase=undefined turn=undefined events=[]"])

    // And the battle save brings them back.
    expect(menu.restore(battle)).toEqual({ _tag: "Success", success: undefined })
    log.length = 0
    menu.tick(Game.Schedule(Read))
    expect(log).toEqual(["phase=Battle turn=Mine events=[]"])

    // A sub-state value whose parent is elsewhere is rejected.
    expect(menu.restore({ ...atMenu, machines: { "SubStates/Session": "Menu", "SubStates/Phase": "Battle" } })).toEqual({
      _tag: "Failure",
      failure: { _tag: "InactiveSubState", name: "SubStates/Phase", parent: "SubStates/Session", requires: "Playing" }
    })

    // A save without the sub-state while its parent is there enters the entry value.
    expect(menu.restore({ ...atMenu, machines: { "SubStates/Session": "Playing" } })).toEqual({ _tag: "Success", success: undefined })
    log.length = 0
    menu.tick(Game.Schedule(Read))
    expect(log).toEqual(["phase=Setup turn=undefined events=[]"])
  })

  it("is described with its parent, and a scope on it counts its parent's next states", () => {
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      machines: Game.Runtime.machines(Game.Runtime.machine(Session, "Menu"), Game.Runtime.machine(Phase, "Setup")),
      debug: { hostClock: HostClock.test() }
    }).success
    runtime.debug.nameSchedules({ update: Game.Schedule(setSession("Playing"), Game.Schedule.applyStateTransitions(transitions)) })
    const description = runtime.debug.describe()
    expect(description.machines.map(({ name, current, provided, within }) => ({ name, current, provided, within }))).toEqual([
      { name: "SubStates/Session", current: "Menu", provided: true, within: undefined },
      { name: "SubStates/Phase", current: undefined, provided: true, within: "SubStates/Session=Playing" },
      { name: "SubStates/Turn", current: undefined, provided: false, within: "SubStates/Phase=Battle" }
    ])
    expect(description.lints.filter((lint) => lint.code === "scope-trigger-never-applied")).toEqual([])
  })
})
