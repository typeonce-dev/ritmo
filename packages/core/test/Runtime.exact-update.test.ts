/**
 * A spread in an `update` callback's result escapes TypeScript's excess
 * property check. Before the check on `update`, a misspelled field compiled,
 * was stored next to the value's own fields, and made the save fail to
 * restore against a strict schema.
 */
import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import { z } from "zod"

const Position = Descriptor.ConstructedComponent(z.strictObject({ x: z.number(), y: z.number() }))("Exact/Position")
const Config = Descriptor.ConstructedResource(z.strictObject({ speed: z.number() }))("Exact/Config")
const Game = Schema.bind(Schema.fragment({ components: { Position }, resources: { Config } }))

const makeRuntime = () => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Config: { speed: 1 } } })
  if (!made.ok) throw new Error("invalid fixture")
  return made.value
}

const Positions = Game.Query({ selection: { position: Game.Query.write(Position) } })

describe("update", () => {
  it("cannot return a misspelled field, so a spread update saves and restores", () => {
    const runtime = makeRuntime()
    const Spawn = Game.System("Exact/Spawn", { commands: Game.System.commands(Game.System.spawns(Position)) }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Position, { x: 0, y: 0 }]))
    })
    const Move = Game.System("Exact/Move", {
      queries: { positions: Positions },
      resources: { config: Game.System.writeResource(Config) }
    }, ({ queries, resources }) => {
      for (const entity of queries.positions.each()) {
        queries.positions.data.position.update(entity, (p) => ({ ...p, x: p.x + 1 }))
      }
      resources.config.update((c) => ({ ...c, speed: c.speed + 1 }))
    })
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), Move))

    const saved = runtime.snapshot()
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(makeRuntime().restore(JSON.parse(JSON.stringify(saved.value))).ok).toBe(true)
  })

  it("does not compile a field the value does not have", () => {
    // Declared, never run: the check is the compiler's.
    Game.System("Exact/Misspelled", {
      queries: { positions: Positions },
      resources: { config: Game.System.writeResource(Config) }
    }, ({ queries, resources }) => {
      for (const entity of queries.positions.each()) {
        // @ts-expect-error Exact/Position has no field xx: return only its own fields
        queries.positions.data.position.update(entity, (p) => ({ ...p, xx: p.x + 1 }))
      }
      // @ts-expect-error Exact/Config has no field extra: return only its own fields
      resources.config.update((c) => ({ ...c, extra: true }))
    })
  })
})
