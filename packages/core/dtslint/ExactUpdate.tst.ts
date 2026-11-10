import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Codecs from "../test/codecs.ts"
import type { EntityProving, ReadonlyValue, WriteSlot } from "@typeonce/ritmo/Query"
import type { QueryIteration } from "@typeonce/ritmo/System"
import { describe, expect, it } from "tstyche"

type Shape = { readonly kind: "circle"; readonly radius: number } | { readonly kind: "box"; readonly width: number }

const Position = Descriptor.Component<{ x: number; y: number }>()("Exact/Position")
const Health = Descriptor.Component<number>()("Exact/Health")
const Path = Descriptor.Component<Array<number>>()("Exact/Path")
const Pair = Descriptor.Component<readonly [number, string]>()("Exact/Pair")
const Scores = Descriptor.Component<Record<string, number>>()("Exact/Scores")
const Body = Descriptor.Component<Shape>()("Exact/Body")
const Named = Descriptor.Component<{ x: number; label?: string }>()("Exact/Named")
const Seen = Descriptor.Component<ReadonlySet<string>>()("Exact/Seen")
const Loose = Descriptor.Component<unknown>()("Exact/Loose")
const Maybe = Descriptor.Component<{ x: number } | null>()("Exact/Maybe")
const Safe = Descriptor.ConstructedComponent(Codecs.struct({ x: Codecs.number, y: Codecs.number }))("Exact/Safe")
const Config = Descriptor.Resource<{ speed: number; debug: boolean }>()("Exact/Config")
const Tuning = Descriptor.ConstructedResource(Codecs.struct({ rate: Codecs.number }))("Exact/Tuning")

const Game = Schema.bind(Schema.fragment({
  components: { Position, Health, Path, Pair, Scores, Body, Named, Seen, Loose, Maybe, Safe },
  resources: { Config, Tuning }
}))

const Moves = Game.Query({
  selection: {
    position: Game.Query.write(Position),
    health: Game.Query.write(Health),
    path: Game.Query.write(Path),
    pair: Game.Query.write(Pair),
    scores: Game.Query.write(Scores),
    body: Game.Query.write(Body),
    named: Game.Query.write(Named),
    seen: Game.Query.write(Seen),
    loose: Game.Query.write(Loose),
    maybe: Game.Query.write(Maybe),
    safe: Game.Query.write(Safe)
  }
})
const Reads = Game.Query({ selection: { position: Game.Query.read(Position) } })

const nudge = (moves: QueryIteration<typeof Game.schema, typeof Moves>) => {
  for (const entity of moves.each()) moves.data.position.update(entity, (p) => ({ ...p, x: p.x + 1 }))
}


// Generic over the value, `update` cannot see the result's fields: such a helper writes with `set`.
const apply = <T, D>(slot: WriteSlot<T, D>, entity: EntityProving<D>, next: (value: ReadonlyValue<T>) => ReadonlyValue<T>) =>
  slot.set(entity, next(slot.get(entity)))

describe("update returns only the value's own fields", () => {
  it("accepts every shape a value can have", () => {
    Game.System("Exact/Valid", {
      queries: { moves: Moves, reads: Reads },
      resources: { config: Game.System.writeResource(Config), tuning: Game.System.writeResource(Tuning) }
    }, ({ queries, resources }) => {
      const { data } = queries.moves
      for (const entity of queries.moves.each()) {
        data.position.update(entity, (p) => ({ ...p, x: p.x + 1 }))
        data.position.update(entity, (p) => ({ x: p.x, y: p.y }))
        data.position.update(entity, (p) => p)
        data.position.update(entity, (p): { x: number; y: number } => ({ ...p, x: 1 }))
        data.health.update(entity, (h) => h + 1)
        data.path.update(entity, (path) => [...path, 1])
        data.pair.update(entity, ([n, s]) => [n + 1, s])
        data.scores.update(entity, (scores) => ({ ...scores, extra: 1 }))
        data.body.update(entity, (body) => body.kind === "circle" ? { ...body, radius: body.radius + 1 } : body)
        data.body.update(entity, () => ({ kind: "box", width: 2 }))
        data.named.update(entity, (n) => ({ ...n, label: "a" }))
        data.named.update(entity, (n) => ({ x: n.x }))
        data.seen.update(entity, (seen) => new Set([...seen, "a"]))
        data.loose.update(entity, () => ({ anything: 1 }))
        data.maybe.update(entity, (m) => m === null ? { x: 0 } : null)
        data.safe.update(entity, (s) => ({ ...s, x: s.x + 1 }))
        data.safe.updateRaw(entity, (s) => ({ x: s.x + 1, y: s.y }))
        data.position.update(entity, (p) => JSON.parse(JSON.stringify(p)))
      }
      for (const entity of queries.reads.each()) {
        const read = queries.reads.data.position.get(entity)
        const moved = queries.moves.get(entity.id)
        if (moved.ok) data.position.update(moved.value, () => read)
      }
      resources.config.update((c) => ({ ...c, speed: c.speed + 1 }))
      resources.config.update((c) => c)
      resources.tuning.update((t) => ({ ...t, rate: 2 }))
      resources.tuning.updateRaw((t) => ({ rate: t.rate * 2 }))
      nudge(queries.moves)
      for (const entity of queries.moves.each()) apply(data.health, entity, (h) => h + 1)
    })
  })

  it("rejects a field the value does not have, spread or not", () => {
    Game.System("Exact/Invalid", {
      queries: { moves: Moves },
      resources: { config: Game.System.writeResource(Config), tuning: Game.System.writeResource(Tuning) }
    }, ({ queries, resources }) => {
      const { data } = queries.moves
      for (const entity of queries.moves.each()) {
        // @ts-expect-error Exact/Position has no field xx: return only its own fields
        data.position.update(entity, (p) => ({ ...p, xx: p.x + 1 }))
        // @ts-expect-error Exact/Position has no field zz: return only its own fields
        data.position.update(entity, (p) => ({ x: p.x, y: p.y, zz: 1 }))
        // @ts-expect-error Exact/Body has no field radiuss: return only its own fields
        data.body.update(entity, (body) => body.kind === "circle" ? { ...body, radiuss: 1 } : body)
        // @ts-expect-error Exact/Safe has no field z: return only its own fields
        data.safe.update(entity, (s) => ({ ...s, z: 1 }))
        // @ts-expect-error Exact/Safe has no field z: return only its own fields
        data.safe.updateRaw(entity, (s) => ({ ...s, z: 1 }))
      }
      // @ts-expect-error Exact/Config has no field extra: return only its own fields
      resources.config.update((c) => ({ ...c, extra: true }))
      // @ts-expect-error Exact/Tuning has no field rat: return only its own fields
      resources.tuning.updateRaw((t) => ({ ...t, rat: 2 }))
    })
  })
})
