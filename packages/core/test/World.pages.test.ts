import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import { makeWorld } from "@typeonce/ritmo/internal/world"

const Health = Descriptor.Component<number>()("WorldPages/Health")
const Speed = Descriptor.Component<number>()("WorldPages/Speed")
const Name = Descriptor.Component<string>()("WorldPages/Name")
const Armor = Descriptor.Component<{ readonly value: number }>()("WorldPages/Armor")
const Game = Schema.bind(Schema.fragment({ components: { Health, Speed, Name, Armor } }))

const components = [Health, Speed, Name, Armor] as const

/** Pages each component's store holds. */
const pageCounts = (world: ReturnType<typeof makeWorld>) =>
  components.map((descriptor) => world.pagesOf(world.ordinalOf(descriptor)).filter((page) => page !== undefined).length)

describe("component pages", () => {
  it("lets go of pages whose entities are gone: storage follows the live entities, not every id given out", () => {
    const world = makeWorld(Game.schema, 64)
    // 1,000 entities alive throughout, replaced every tick: ids grow without end.
    let alive: Array<number> = []
    for (let tick = 0; tick < 300; tick++) {
      for (const id of alive) world.destroyEntity(id)
      alive = []
      for (let index = 0; index < 1000; index++) {
        const id = world.allocateEntity()
        world.spawnEntity(id, [[Health, 1], [Speed, 2], [Name, "crowd"], [Armor, { value: 3 }]])
        alive.push(id)
      }
    }
    // 1,000 ids span 4 or 5 pages of 256: about 300,000 ids were given out.
    for (const count of pageCounts(world)) expect(count).toBeLessThanOrEqual(5)
  })

  it("puts a page released after a mark back on rewind, over the one made since for new ids", () => {
    const world = makeWorld(Game.schema, 64)
    const health = world.ordinalOf(Health)
    const first = [1, 2, 3].map((value) => {
      const id = world.allocateEntity()
      world.spawnEntity(id, [[Health, value]])
      return id
    })
    const page = world.pagesOf(health)[0]
    const mark = world.takeMark()
    for (const id of first) world.destroyEntity(id)
    expect(pageCounts(world)[0]).toBe(0)
    // New ids on the same page: a new page object.
    const later = [7, 8].map((value) => {
      const id = world.allocateEntity()
      world.spawnEntity(id, [[Health, value]])
      return id
    })
    expect(world.pagesOf(health)[0]).not.toBe(page)
    world.rewindToMark(mark)
    expect(world.pagesOf(health)[0]).toBe(page)
    expect(first.map((id) => world.valueAt(world.records.get(id)!, health))).toEqual([1, 2, 3])
    expect(later.map((id) => world.records.has(id))).toEqual([false, false])
    // The rewound page takes writes and releases like any other.
    for (const id of first) world.destroyEntity(id)
    expect(pageCounts(world)[0]).toBe(0)
  })

  it("lets go on rewind of a page made after the mark", () => {
    const world = makeWorld(Game.schema, 64)
    const mark = world.takeMark()
    world.spawnEntity(world.allocateEntity(), [[Health, 1], [Name, "late"]])
    expect(pageCounts(world)).toEqual([1, 0, 1, 0])
    world.rewindToMark(mark)
    expect(pageCounts(world)).toEqual([0, 0, 0, 0])
  })
})
