import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"

const Position = Descriptor.Component<{ x: number }>()("AnyOf/Position")
const Sprite = Descriptor.Component<string>()("AnyOf/Sprite")
const Paved = Descriptor.Component<{}>()("AnyOf/Paved")

const Game = Schema.bind(Schema.fragment({ components: { Position, Sprite, Paved } }))

const makeRuntime = () => Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.test() } }).success

const Redraw = Game.Query({
  selection: { position: Game.Query.read(Position) },
  filters: [Game.Query.anyOf(Game.Query.changed(Position), Game.Query.changed(Sprite))]
})

const observer = () => {
  const runs: Array<Array<number>> = []
  const system = Game.System("AnyOf/Observer", { queries: { redraw: Redraw } }, ({ queries }) => {
    runs.push(queries.redraw.each().map((match) => match.data.position.get().x))
  })
  return { system, runs }
}

const spawn = (count: number) => Game.System("AnyOf/Spawn", {
  commands: Game.System.commands(Game.System.spawns(Position, Sprite))
}, ({ commands }) => {
  for (let x = 0; x < count; x++) {
    commands.spawn(Game.Command.spawn([Position, { x }], [Sprite, "idle"]))
  }
})

const touch = (name: string, pick: (x: number) => boolean, slot: "position" | "sprite") =>
  Game.System(name, {
    queries: {
      all: Game.Query({ selection: { position: Game.Query.write(Position), sprite: Game.Query.write(Sprite) } })
    }
  }, ({ queries }) => {
    for (const { data } of queries.all.each()) {
      if (!pick(data.position.get().x)) continue
      if (slot === "position") data.position.update((position) => ({ x: position.x }))
      else data.sprite.set("hit")
    }
  })

describe("Game.Query.anyOf", () => {
  it("matches an entity once when any member passes", () => {
    const reader = observer()
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawn(3), Game.Schedule.applyDeferred(), reader.system))
    runtime.tick(Game.Schedule(
      touch("AnyOf/MovePosition", (x) => x === 0, "position"),
      touch("AnyOf/RestyleSprite", (x) => x === 0 || x === 2, "sprite"),
      reader.system
    ))
    runtime.tick(Game.Schedule(reader.system))

    // First run sees everything; then entity 0 (both changed) once and entity 2 (sprite only).
    expect(reader.runs).toEqual([[0, 1, 2], [0, 2], []])
  })

  it("uses the change logs once the reader is past its first run", () => {
    const reader = observer()
    const runtime = makeRuntime()
    // Enough entities that one change takes the change-log path, not a scan of every match.
    runtime.tick(Game.Schedule(spawn(40), Game.Schedule.applyDeferred(), reader.system))
    for (let tick = 0; tick < 5; tick++) runtime.tick(Game.Schedule(reader.system))
    runtime.tick(Game.Schedule(touch("AnyOf/RestyleOne", (x) => x === 1, "sprite"), reader.system))
    expect(reader.runs.at(-1)).toEqual([1])
  })

  it("mixes added and changed members, and combines with other filters by AND", () => {
    const seen: Array<Array<number>> = []
    const Index = Game.System("AnyOf/Index", {
      queries: {
        tiles: Game.Query({
          selection: { position: Game.Query.read(Position) },
          filters: [Game.Query.anyOf(Game.Query.added(Paved), Game.Query.changed(Sprite)), Game.Query.changed(Position)]
        })
      }
    }, ({ queries }) => {
      seen.push(queries.tiles.each().map((match) => match.data.position.get().x))
    })
    const Pave = Game.System("AnyOf/Pave", {
      queries: { all: Game.Query({ selection: { position: Game.Query.read(Position) } }) },
      commands: Game.System.commands(Game.System.inserts(Paved))
    }, ({ queries, commands }) => {
      for (const match of queries.all.each()) {
        if (match.data.position.get().x === 1) commands.insert(match.entity.id, [Paved, {}])
      }
    })
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawn(3), Game.Schedule.applyDeferred(), Index))
    // Paved is added to 1, but its Position did not change: the second filter rejects it.
    runtime.tick(Game.Schedule(Pave, Game.Schedule.applyDeferred(), Index))
    // Position changes on 1 and 2, but neither was paved or restyled since Index's previous run.
    runtime.tick(Game.Schedule(touch("AnyOf/Move12", (x) => x >= 1, "position"), Index))
    // Position and Sprite change on 2: both filters pass.
    runtime.tick(Game.Schedule(touch("AnyOf/Move2", (x) => x === 2, "position"), touch("AnyOf/Restyle2", (x) => x === 2, "sprite"), Index))
    expect(seen).toEqual([[0, 1, 2], [], [], [2]])
  })

  it("is described as one any-of entry", () => {
    const reader = observer()
    const runtime = makeRuntime()
    runtime.debug.nameSchedules({ update: Game.Schedule(reader.system) })
    const query = runtime.debug.describe().systems[0]?.queries[0]
    expect(query?.anyOf).toEqual([{ added: [], changed: ["AnyOf/Position", "AnyOf/Sprite"] }])
    expect(query?.changed).toEqual([])
  })
})
