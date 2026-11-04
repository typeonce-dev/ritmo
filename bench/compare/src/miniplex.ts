import { World } from "miniplex"
import { letters, type Library } from "./cases.ts"

type Entity = Partial<Record<string, number>>

export const miniplex: Library = {
  packed_5: () => {
    const world = new World<Entity>()
    for (let index = 0; index < 1000; index++) world.add({ A: 1, B: 1, C: 1, D: 1, E: 1 })
    const queries = ["A", "B", "C", "D", "E"].map((name) => [name, world.with(name)] as const)
    return {
      run: () => {
        for (const [name, entities] of queries) for (const entity of entities) entity[name]! *= 2
      }
    }
  },
  simple_iter: () => {
    const world = new World<Entity>()
    for (let index = 0; index < 1000; index++) {
      world.add({ A: 1, B: 1 })
      world.add({ A: 1, B: 1, C: 1 })
      world.add({ A: 1, B: 1, C: 1, D: 1 })
      world.add({ A: 1, B: 1, C: 1, E: 1 })
    }
    const pairs = [["A", "B"], ["C", "D"], ["C", "E"]].map(([left, right]) => [left!, right!, world.with(left!, right!)] as const)
    return {
      run: () => {
        for (const [left, right, entities] of pairs) {
          for (const entity of entities) {
            const value = entity[left]
            entity[left] = entity[right]
            entity[right] = value
          }
        }
      }
    }
  },
  frag_iter: () => {
    const world = new World<Entity>()
    for (const letter of letters) for (let index = 0; index < 100; index++) world.add({ [letter]: 1, Data: 1 })
    const entities = world.with("Data")
    return { run: () => { for (const entity of entities) entity.Data! *= 2 } }
  },
  entity_cycle: () => {
    const world = new World<Entity>()
    for (let index = 0; index < 1000; index++) world.add({ A: 1 })
    const sources = world.with("A")
    const spawned = world.with("B")
    return {
      run: () => {
        for (const _ of sources) world.add({ B: 1 })
        for (const entity of spawned) world.remove(entity)
      }
    }
  },
  add_remove: () => {
    const world = new World<Entity>()
    for (let index = 0; index < 1000; index++) world.add({ A: 1 })
    const sources = world.with("A")
    const withB = world.with("B")
    return {
      run: () => {
        for (const entity of sources) world.addComponent(entity, "B", 1)
        for (const entity of withB) world.removeComponent(entity, "B")
      }
    }
  },
  move: () => {
    type Mover = { readonly position: { x: number; y: number }; readonly velocity: { readonly x: number; readonly y: number } }
    const world = new World<Mover>()
    for (let index = 0; index < 100_000; index++) world.add({ position: { x: 0, y: 0 }, velocity: { x: 1, y: 2 } })
    const movers = world.with("position", "velocity")
    return {
      run: () => {
        for (const entity of movers) {
          entity.position.x += entity.velocity.x
          entity.position.y += entity.velocity.y
        }
      }
    }
  }
}
