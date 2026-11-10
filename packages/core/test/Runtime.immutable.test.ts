import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"

const Position = Descriptor.Component<{ x: number }>()("Immutable/Position")
const Kind = Descriptor.Component<"wall" | "pickup">()("Immutable/Kind", { immutable: true })

const Game = Schema.bind(Schema.fragment({ components: { Position, Kind } }))

const makeRuntime = () => Game.Runtime.make({ services: Game.Runtime.services() }).value

const Spawn = Game.System("Immutable/Spawn", {
  commands: Game.System.commands(Game.System.spawns(Position, Kind))
}, ({ commands }) => {
  for (let x = 0; x < 3; x++) {
    commands.spawn(Game.Command.spawn([Position, { x }], [Kind, "wall"]))
  }
})

describe("immutable components", () => {
  it("marks the descriptor at runtime", () => {
    expect(Descriptor.isImmutable(Kind)).toBe(true)
    expect(Descriptor.isImmutable(Position)).toBe(false)
  })

  it("rejects a write slot built through an erased type", () => {
    const write = Game.Query.write as (descriptor: unknown) => unknown
    expect(() => write(Kind)).toThrow("Immutable/Kind is immutable: replace it with commands.insert(entity, [Immutable/Kind, value])")
  })

  it("is replaced by insert, which changed(...) sees", () => {
    const seen: Array<Array<string>> = []
    const Watch = Game.System("Immutable/Watch", {
      queries: { kinds: Game.Query({ selection: { kind: Game.Query.read(Kind) }, filters: [Game.Query.changed(Kind)] }) }
    }, ({ queries }) => {
      seen.push(queries.kinds.each().map((entity) => queries.kinds.data.kind.get(entity)))
    })
    const Upgrade = Game.System("Immutable/Upgrade", {
      queries: { kinds: Game.Query({ selection: { kind: Game.Query.read(Kind), position: Game.Query.read(Position) } }) },
      commands: Game.System.commands(Game.System.inserts(Kind))
    }, ({ queries, commands }) => {
      const { data } = queries.kinds
      for (const entity of queries.kinds.each()) {
        if (data.position.get(entity).x === 1) commands.insert(entity.id, [Kind, "pickup"])
      }
    })
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), Watch))
    runtime.tick(Game.Schedule(Upgrade, Game.Schedule.applyDeferred(), Watch))
    expect(seen).toEqual([["wall", "wall", "wall"], ["pickup"]])
  })
})
