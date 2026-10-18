import { Descriptor, Schema, Decode, Result } from "@typeonce/ritmo"
import { expect, it } from "vitest"

const symbol = Symbol.for("@typeonce/ritmo/native@0.8")
it("keeps column views, journal rollback, snapshots, and slot reuse consistent", () => {
  const P = Descriptor.ConstructedComponent(Decode.struct({ x: Decode.number, y: Decode.number }))("Native/P")
  const Game = Schema.bind(Schema.fragment({ components: { P } }))
  const seam = (Game as any)[symbol]
  expect(seam).toBeDefined()
  seam.layouts({ "Native/P": ["x", "y"] })
  const Spawn = Game.System("Spawn", { commands: Game.System.commands(Game.System.spawns(P)) }, ({ commands }) => {
    commands.spawn(Game.Command.spawn([P, { x: -0, y: 2 }]))
  })
  const query = Game.Query({ selection: { p: Game.Query.write(P) } })
  let seen: unknown
  const Write = Game.System("Write", { queries: { q: query } }, ({ queries }) => {
    const view = (queries.q as any)[symbol].view()
    expect(view.slots).toBeInstanceOf(Int32Array)
    expect(view.columns[0]).toBeInstanceOf(Float64Array)
    expect(Object.is(view.columns[0][view.slots[0]], -0)).toBe(true)
    const first = queries.q.each()[0]!
    first.data.p.set({ x: 3, y: 4 }); seen = first.data.p.get()
  })
  const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).value
  expect(runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), Write)).ok).toBe(true)
  expect(seen).toEqual({ x: 3, y: 4 })
  expect(runtime.snapshot().entities[0]?.components["Native/P"]).toEqual({ x: 3, y: 4 })
  let rolledBack = false, released = false
  const Broken = Game.System("Broken", { queries: { q: query } }, ({ queries }) => {
    const view = (queries.q as any)[symbol].view(), slot = view.slots[0], before = view.columns[0][slot]
    view.columns[0][slot] = 999
    view.journal({ commit() { throw new Error("failed systems cannot commit") }, rollback() { view.columns[0][slot] = before; rolledBack = true }, release() { released = true } })
    return Result.failure("stop")
  })
  expect(runtime.tick(Game.Schedule(Broken)).ok).toBe(false)
  expect(rolledBack && released).toBe(true)
  expect(runtime.snapshot().entities[0]?.components["Native/P"]).toEqual({ x: 3, y: 4 })
})
it("rejects an incorrect numeric layout with its component name", () => {
  const P = Descriptor.Component<{ x: number }>()("Native/Invalid")
  const Game = Schema.bind(Schema.fragment({ components: { P } }))
  ;(Game as any)[symbol].layouts({ "Native/Invalid": ["y"] })
  const Spawn = Game.System("Spawn", { commands: Game.System.commands(Game.System.spawns(P)) }, ({ commands }) => {
    commands.spawn(Game.Command.spawn([P, { x: 1 }]))
  })
  const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).value
  expect(() => runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))).toThrow("Native/Invalid")
})
