/**
 * What bitECS, Koota, and Miniplex do with the mistakes the website's
 * comparison page lists (`website/src/pages/docs/comparison.mdx`). Each
 * claim the page makes about another library is checked here against the
 * versions this workspace pins; a library upgrade that changes one fails
 * the test, and the page is updated with it.
 */
import * as B from "bitecs"
import { createSnapshotDeserializer, createSnapshotSerializer, f64 } from "bitecs/serialization"
import { createWorld, trait } from "koota"
import { World } from "miniplex"
import { describe, expect, it } from "vitest"

describe("a reference kept after its entity is despawned", () => {
  it("bitECS: the id is recycled, and the old reference reads the new entity", () => {
    const world = B.createWorld()
    const Health = { value: [] as Array<number> }
    const first = B.addEntity(world)
    B.addComponent(world, first, Health)
    Health.value[first] = 10
    B.removeEntity(world, first)
    const second = B.addEntity(world)
    B.addComponent(world, second, Health)
    Health.value[second] = 99
    expect(second).toBe(first)
    expect(B.entityExists(world, first)).toBe(true)
    expect(Health.value[first]).toBe(99)
  })

  it("Koota: the old handle is not alive, yet reads the new entity's data", () => {
    const world = createWorld()
    const Health = trait({ value: 0 })
    const first = world.spawn(Health({ value: 10 }))
    first.destroy()
    world.spawn(Health({ value: 99 }))
    expect(first.isAlive()).toBe(false)
    expect(first.has(Health)).toBe(true)
    expect(first.get(Health)).toEqual({ value: 99 })
  })

  it("Miniplex: the removed entity is a plain object that keeps taking writes", () => {
    const world = new World<{ health?: number }>()
    const entity = world.add({ health: 10 })
    world.remove(entity)
    entity.health = 5
    expect(world.has(entity)).toBe(false)
    expect(entity.health).toBe(5)
  })
})

describe("removing a component while iterating its query", () => {
  // Not a difference: all three visit every entity. The page leaves it out.
  it("visits every entity in all three", () => {
    const bit = B.createWorld()
    const A = { v: [] as Array<number> }
    for (let index = 0; index < 6; index++) B.addComponent(bit, B.addEntity(bit), A)
    let bitVisited = 0
    for (const eid of B.query(bit, [A])) {
      bitVisited++
      B.removeComponent(bit, eid, A)
    }

    const koota = createWorld()
    const K = trait({ v: 0 })
    for (let index = 0; index < 6; index++) koota.spawn(K)
    let kootaVisited = 0
    koota.query(K).forEach((entity) => {
      kootaVisited++
      entity.remove(K)
    })

    const mini = new World<{ a?: number }>()
    for (let index = 0; index < 6; index++) mini.add({ a: 1 })
    let miniVisited = 0
    for (const entity of mini.with("a")) {
      miniVisited++
      mini.removeComponent(entity, "a")
    }

    expect([bitVisited, kootaVisited, miniVisited]).toEqual([6, 6, 6])
  })
})

describe("a system that throws halfway", () => {
  it("keeps the writes it made before throwing, in all three", () => {
    const bit = B.createWorld()
    const Health = { value: [] as Array<number> }
    for (let index = 0; index < 4; index++) {
      const eid = B.addEntity(bit)
      B.addComponent(bit, eid, Health)
      Health.value[eid] = 10
    }
    const koota = createWorld()
    const KHealth = trait({ value: 10 })
    for (let index = 0; index < 4; index++) koota.spawn(KHealth)
    const mini = new World<{ health: number }>()
    for (let index = 0; index < 4; index++) mini.add({ health: 10 })

    const halfway = (write: (index: number) => void) => {
      try {
        for (let index = 0; index < 4; index++) {
          if (index === 2) throw new Error("bug")
          write(index)
        }
      } catch {
        // The game's loop catches it, or the frame crashes: either way nothing is undone.
      }
    }
    const bitIds = [...B.query(bit, [Health])]
    halfway((index) => {
      Health.value[bitIds[index]!] = 0
    })
    const kootaEntities = [...koota.query(KHealth)]
    halfway((index) => kootaEntities[index]!.set(KHealth, { value: 0 }))
    const miniEntities = [...mini.entities]
    halfway((index) => {
      miniEntities[index]!.health = 0
    })

    expect(bitIds.map((eid) => Health.value[eid])).toEqual([0, 0, 10, 10])
    expect(kootaEntities.map((entity) => entity.get(KHealth)!.value)).toEqual([0, 0, 10, 10])
    expect(miniEntities.map((entity) => entity.health)).toEqual([0, 0, 10, 10])
  })
})

describe("loading a corrupted save", () => {
  it("bitECS: the snapshot deserializer reads the bytes back unchecked", () => {
    const source = B.createWorld()
    const Health = { value: f64([]) }
    const eid = B.addEntity(source)
    B.addComponent(source, eid, Health)
    Health.value[eid] = 10
    const packet = createSnapshotSerializer(source, [Health])()
    // Flip bits in the stored value.
    const bytes = new Uint8Array(packet)
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff
    const target = B.createWorld()
    const Loaded = { value: f64([]) }
    expect(() => createSnapshotDeserializer(target, [Loaded])(packet)).not.toThrow()
    expect(Loaded.value.filter((value) => value !== undefined)).not.toEqual([10])
  })
})

describe("a system that writes what it never declared", () => {
  // Nothing declares a system's access in any of the three: a loop over one
  // query writes any other component, and nothing stops it.
  it("runs in all three", () => {
    const bit = B.createWorld()
    const Position = { x: [] as Array<number> }
    const Velocity = { x: [] as Array<number> }
    const eid = B.addEntity(bit)
    B.addComponent(bit, eid, Position)
    B.addComponent(bit, eid, Velocity)
    for (const id of B.query(bit, [Position])) Velocity.x[id] = 7
    expect(Velocity.x[eid]).toBe(7)

    const koota = createWorld()
    const KPosition = trait({ x: 0 })
    const KVelocity = trait({ x: 0 })
    const entity = koota.spawn(KPosition, KVelocity)
    for (const found of koota.query(KPosition)) found.set(KVelocity, { x: 7 })
    expect(entity.get(KVelocity)).toEqual({ x: 7 })

    const mini = new World<{ position?: { x: number }; velocity?: { x: number } }>()
    const added = mini.add({ position: { x: 0 }, velocity: { x: 0 } })
    for (const found of mini.with("position")) found.velocity = { x: 7 }
    expect(added.velocity).toEqual({ x: 7 })
  })
})

describe("logic that calls Math.random()", () => {
  // None of the three has a notion of simulation code, so nothing reports it.
  it("runs in all three", () => {
    const bit = B.createWorld()
    const Roll = { value: [] as Array<number> }
    B.addComponent(bit, B.addEntity(bit), Roll)
    for (const id of B.query(bit, [Roll])) Roll.value[id] = Math.random()
    expect(Roll.value.every((value) => value >= 0 && value < 1)).toBe(true)

    const koota = createWorld()
    const KRoll = trait({ value: -1 })
    const entity = koota.spawn(KRoll)
    for (const found of koota.query(KRoll)) found.set(KRoll, { value: Math.random() })
    expect(entity.get(KRoll)!.value).toBeGreaterThanOrEqual(0)

    const mini = new World<{ roll?: number }>()
    const added = mini.add({ roll: -1 })
    for (const found of mini.with("roll")) found.roll = Math.random()
    expect(added.roll).toBeGreaterThanOrEqual(0)
  })
})

describe("saving and loading a world", () => {
  // bitECS ships serializers (checked above); Koota and Miniplex ship none,
  // so a save format, and checking one when it loads, is the game's to write.
  it("Koota and Miniplex export no snapshot or serializer", async () => {
    const koota = await import("koota")
    const miniplex = await import("miniplex")
    const saving = (names: ReadonlyArray<string>) => names.filter((name) => /serial|snapshot|save|load/i.test(name))
    expect(saving(Object.keys(koota))).toEqual([])
    expect(saving(Object.keys(miniplex))).toEqual([])
  })
})
