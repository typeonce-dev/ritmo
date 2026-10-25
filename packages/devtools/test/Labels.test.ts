import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import type { Snapshot } from "@typeonce/ritmo"
import { Desync, Determinism, Format, Invariant, Session } from "@typeonce/ritmo-devtools"

const hostClock = HostClock.test()

const Position = Descriptor.Component<{ readonly x: number }>()("Labels/Position")
const Health = Descriptor.Component<number>()("Labels/Health")
const Player = Descriptor.Tag("Labels/Player")
const Slime = Descriptor.Tag("Labels/Slime")
const Game = Schema.bind(Schema.fragment({ components: { Position, Health, Player, Slime } }))

const Spawn = Game.System("Labels/Spawn", { commands: Game.System.commands(Game.System.spawns(Position, Health, Player, Slime)) }, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Position, { x: 0 }], [Health, 3], [Player, {}]))
  commands.spawn(Game.Command.spawn([Position, { x: 10 }], [Slime, {}]))
  commands.spawn(Game.Command.spawn([Position, { x: 20 }]))
})
const Move = Game.System("Labels/Move", {
  queries: { movers: Game.Query({ selection: { position: Game.Query.write(Position) } }) }
}, ({ queries }) => {
  for (const match of queries.movers.each()) match.data.position.update((position) => ({ x: position.x + 1 }))
})
const Hurt = Game.System("Labels/Hurt", {
  queries: { healthy: Game.Query({ selection: { health: Game.Query.write(Health) } }) }
}, ({ queries }) => {
  for (const match of queries.healthy.each()) match.data.health.update((health) => health - 1)
})
const Squash = Game.System("Labels/Squash", {
  queries: { slimes: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Slime] }) },
  commands: Game.System.commands(Game.System.despawns(Slime))
}, ({ queries, commands }) => {
  for (const { entity, data } of queries.slimes.each()) if (data.position.get().x >= 12) commands.despawn(entity)
})

/** The player is `player` while healthy and `player:hurt` below 2 health; slimes are `enemy:slime`. */
const Labels = Game.Inspector("labels", {
  queries: {
    players: Game.Query({ selection: { health: Game.Query.read(Health) }, with: [Player] }),
    slimes: Game.Query({ selection: { slime: Game.Query.read(Slime) } })
  }
}, ({ queries }) => new Map([
  ...queries.players.each().map((match) => [match.entity.id, match.data.health.get() < 2 ? "player:hurt" : "player"] as const),
  ...queries.slimes.each().map((match) => [match.entity.id, "enemy:slime"] as const)
]))

const PlayerAlive = Invariant.fromInspector(Game.Inspector("player alive", {
  queries: { players: Game.Query({ selection: { health: Game.Query.read(Health) }, with: [Player] }) }
}, ({ queries }) => queries.players.each().map((match) => match.data.health.get() <= 0 ? `e${match.entity.id} has ${match.data.health.get()} health` : undefined).find((message) => message !== undefined)))

const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
const update = Game.Schedule(Move, Hurt, Squash, Game.Schedule.applyDeferred())

const makeRuntime = () => Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).value

const makeSession = (labelled: boolean) => {
  const runtime = makeRuntime()
  const session = labelled
    ? Session.make(runtime, { hostClock, schedules: { setup, update }, invariants: [PlayerAlive], labels: Labels })
    : Session.make(runtime, { hostClock, schedules: { setup, update }, invariants: [PlayerAlive] })
  session.run("setup")
  return { runtime, session }
}

describe("Format.entity", () => {
  it("prints a labelled entity as `label eN`, any other as `eN`", () => {
    const labels = new Map([[12, "player"], [13, ""]])
    expect(Format.entity(12, labels)).toBe("player e12")
    expect(Format.entity(13, labels)).toBe("e13")
    expect(Format.entity(14, labels)).toBe("e14")
    expect(Format.entity(12)).toBe("e12")
  })
})

describe("Session labels", () => {
  it("names labelled entities in why, journal, dump, and invariant messages; others print as ids", () => {
    const { session } = makeSession(true)
    const run = session.run("update", { frames: 5 })
    expect(run.data.stop).toEqual({ reason: "invariant", frame: 4, invariant: "player alive", message: "e1 has 0 health" })
    expect(run.text).toContain(`INVARIANT "player alive" violated at f4: player:hurt e1 has 0 health`)

    expect(session.why(1, Position).text.split("\n")[0]).toBe("player:hurt e1 Labels/Position is now {x:3}; last 4 changes (oldest first):")
    expect(session.why(3, Position).text.split("\n")[0]).toBe("e3 Labels/Position is now {x:23}; last 4 changes (oldest first):")

    const spawns = session.journal({ frames: 1, kinds: ["effect"] })
    expect(spawns.data.map((line) => line.text)).toEqual([
      "applyDeferred: spawn player e1 Labels/Position={x:0} Labels/Health=3 Labels/Player={}",
      "applyDeferred: spawn enemy:slime e2 Labels/Position={x:10} Labels/Slime={}",
      "applyDeferred: spawn e3 Labels/Position={x:20}"
    ])
    expect(spawns.data.map((line) => line.label)).toEqual(["player", "enemy:slime", undefined])

    const dump = session.dump().text
    expect(dump).toContain("player:hurt e1  Labels/Position={x:3}")
    expect(dump).toContain("\ne3  Labels/Position={x:23}")
  })

  it("shows the label each line's frame had, and keeps a despawned entity's last label", () => {
    const { session } = makeSession(true)
    session.run("update", { frames: 3 })
    const writes = session.journal({ entity: 1, kinds: ["write"], system: "Labels/Hurt" }).data.map((line) => `f${line.frame} ${line.text}`)
    // Health 3 -> 2 keeps `player`; from 1 it is `player:hurt`.
    expect(writes).toEqual([
      "f2 write player e1 Labels/Health 3 -> 2",
      "f3 write player:hurt e1 Labels/Health 2 -> 1",
      "f4 write player:hurt e1 Labels/Health 1 -> 0"
    ])
    // The slime is despawned at f3 (x 12) and keeps its label.
    expect(session.journal({ entity: 2, kinds: ["effect"], frames: 3 }).data.map((line) => line.text)).toEqual(["applyDeferred: despawn enemy:slime e2"])
    expect(session.why(2, Position).text.split("\n")[0]).toBe("enemy:slime e2 is not alive; last 4 changes (oldest first):")
  })

  it("labels frames the game ticked outside run when queried", () => {
    const { runtime, session } = makeSession(true)
    runtime.tick(update)
    expect(session.journal({ frames: 2, system: "Labels/Hurt" }).data.map((line) => line.text)).toEqual(["write player e1 Labels/Health 3 -> 2"])
  })

  it("prints only ids without labels", () => {
    const { session } = makeSession(false)
    const run = session.run("update", { frames: 5 })
    expect(run.text).toContain(`violated at f4: e1 has 0 health`)
    expect(session.journal({ frames: 1, kinds: ["effect"] }).data.map((line) => [line.text, line.label])[0]).toEqual([
      "applyDeferred: spawn e1 Labels/Position={x:0} Labels/Health=3 Labels/Player={}",
      undefined
    ])
    expect(session.why(1, Position).text.split("\n")[0]).toBe("e1 Labels/Position is now {x:3}; last 4 changes (oldest first):")
  })

  it("names entities in report warnings", () => {
    const Broken = Game.System("Labels/Broken", {
      queries: { players: Game.Query({ selection: { position: Game.Query.write(Position) }, with: [Player] }) }
    }, ({ queries }) => {
      for (const match of queries.players.each()) match.data.position.set({ x: Number.NaN })
    })
    const runtime = makeRuntime()
    const session = Session.make(runtime, { hostClock, schedules: { setup, broken: Game.Schedule(Broken) }, labels: Labels })
    session.run("setup")
    session.run("broken")
    expect(session.report().data.warnings.map((warning) => warning.message)).toEqual([
      "Labels/Broken wrote a NaN or infinite number to player e1 Labels/Position.x (first at f2; why() shows its history)"
    ])
  })

  it("stops a run when the labels inspector throws", () => {
    const Throws = Game.Inspector("throwing labels", {}, (): ReadonlyMap<number, string> => {
      throw new Error("broken labels")
    })
    const session = Session.make(makeRuntime(), { hostClock, schedules: { setup }, labels: Throws })
    const run = session.run("setup")
    expect(run.data.stop).toMatchObject({ reason: "labels-threw", frame: 1 })
    expect(run.text).toContain("LABELS threw at f1")
    // Queries still print, without labels.
    expect(session.dump().text).toContain("\ne1  ")
  })
})

describe("labels in diffs", () => {
  it("Desync.compare names entities with the labels it is given", () => {
    const save = (x: number): Snapshot.WorldSnapshot => ({
      version: 3, gameVersion: 0, nextEntity: 3, relations: {}, resources: {}, machines: {}, scopes: {},
      entities: [{ id: 1, components: { "Labels/Position": { x } } }, { id: 2, components: { "Labels/Position": { x } } }]
    })
    const runtime = makeRuntime()
    runtime.tick(setup)
    const compared = Desync.compare(save(1), save(2), { labels: runtime.inspect(Labels) })
    expect(compared.data.map((difference) => [difference.path, difference.entity])).toEqual([
      ["entity 1 Labels/Position.x", 1],
      ["entity 2 Labels/Position.x", 2]
    ])
    expect(compared.text).toBe("2 differences (mine -> theirs):\n  player e1 Labels/Position.x: 1 -> 2\n  enemy:slime e2 Labels/Position.x: 1 -> 2")
  })

  it("Determinism.check names the differing entity and its label", () => {
    let counter = 0
    const Drift = Game.System("Labels/Drift", {
      queries: { players: Game.Query({ selection: { position: Game.Query.write(Position) }, with: [Player] }) }
    }, ({ queries }) => {
      for (const match of queries.players.each()) match.data.position.set({ x: ++counter })
    })
    const result = Determinism.check(({ hostClock }) => {
      const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).value
      runtime.tick(setup)
      return { runtime, schedules: { update: Game.Schedule(Drift) } }
    }, { schedule: "update", frames: 2, hostClock, labels: Labels })
    expect(result).toMatchObject({ ok: false, frame: 1, reason: "difference", entity: 1, label: "player", after: "Labels/Drift" })
  })
})
