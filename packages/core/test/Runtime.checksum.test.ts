import { describe, expect, it } from "vitest"

import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"

const point = Codecs.struct({ x: Codecs.number, y: Codecs.number })
const Position = Descriptor.ConstructedComponent(point)("Checksum/Position")
const Label = Descriptor.ConstructedComponent(Codecs.string)("Checksum/Label")
const Cache = Descriptor.TransientComponent<{ readonly hits: number }>()("Checksum/Cache")
const Score = Descriptor.ConstructedResource(Codecs.number)("Checksum/Score")
const Frame = Descriptor.TransientResource<number>()("Checksum/Frame")
const Game = Schema.bind(Schema.fragment({ components: { Position, Label, Cache }, resources: { Score, Frame } }))

const makeRuntime = (score = 0, frame = 0) => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Score: score, Frame: frame } })
  if (!made.ok) throw new Error("the resources did not validate")
  return made.value
}

const spawnAccess = { commands: Game.System.commands(Game.System.spawns(Position, Label, Cache)) }
const Spawn = Game.System("Checksum/Spawn", spawnAccess, () => {})
const spawning = (run: (context: Parameters<typeof Spawn.run>[0]) => void) =>
  Game.Schedule(Game.System("Checksum/Spawn", spawnAccess, run), Game.Schedule.applyDeferred())

const checksumOf = (runtime: ReturnType<typeof makeRuntime>) => {
  const sum = runtime.checksum()
  if (!sum.ok) throw new Error("checksum failed")
  return sum.value
}

describe("runtime.checksum", () => {
  it("is 16 hex digits, the same for the same world", () => {
    const sum = checksumOf(makeRuntime())
    expect(sum).toMatch(/^[0-9a-f]{16}$/)
    expect(checksumOf(makeRuntime())).toBe(sum)
  })

  it("does not depend on the order components were added or object keys written", () => {
    const first = makeRuntime()
    const second = makeRuntime()
    expect(first.tick(spawning(({ commands }) => { commands.spawn(Game.Command.spawn([Position, { x: 1, y: 2 }], [Label, "a"])) })).ok).toBe(true)
    expect(second.tick(spawning(({ commands }) => { commands.spawn(Game.Command.spawn([Label, "a"], [Position, { y: 2, x: 1 }])) })).ok).toBe(true)
    expect(JSON.stringify(worldOf(first))).not.toBe(JSON.stringify(worldOf(second)))
    expect(checksumOf(first)).toBe(checksumOf(second))
  })

  it("changes with any saved value", () => {
    const base = makeRuntime()
    const moved = makeRuntime()
    expect(base.tick(spawning(({ commands }) => { commands.spawn(Game.Command.spawn([Position, { x: 1, y: 2 }])) })).ok).toBe(true)
    expect(moved.tick(spawning(({ commands }) => { commands.spawn(Game.Command.spawn([Position, { x: 1, y: 3 }])) })).ok).toBe(true)
    expect(checksumOf(base)).not.toBe(checksumOf(moved))
    expect(checksumOf(makeRuntime(1))).not.toBe(checksumOf(makeRuntime(0)))
  })

  it("hashes -0 as 0, as a save writes it", () => {
    expect(checksumOf(makeRuntime(-0))).toBe(checksumOf(makeRuntime(0)))
  })

  it("skips transient components and resources, like a snapshot", () => {
    const plain = makeRuntime(0, 1)
    const cached = makeRuntime(0, 2)
    expect(plain.tick(spawning(({ commands }) => { commands.spawn(Game.Command.spawn([Position, { x: 1, y: 2 }])) })).ok).toBe(true)
    expect(cached.tick(spawning(({ commands }) => { commands.spawn(Game.Command.spawn([Position, { x: 1, y: 2 }], [Cache, { hits: 3 }])) })).ok).toBe(true)
    expect(checksumOf(plain)).toBe(checksumOf(cached))
  })

  it("throws while a schedule is running", () => {
    const runtime = makeRuntime()
    const Inside = Game.System("Checksum/Inside", {}, () => {
      runtime.checksum()
    })
    expect(() => runtime.tick(Game.Schedule(Inside))).toThrow("runtime.checksum was called while a schedule is running")
  })
})

const worldOf = (runtime: ReturnType<typeof makeRuntime>) => {
  const saved = runtime.snapshot()
  if (!saved.ok) throw new Error("snapshot failed")
  return saved.value
}
