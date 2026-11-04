import { addComponent, addEntity, createWorld, query, removeComponent, removeEntity } from "bitecs"
import { letters, type Library } from "./cases.ts"

// bitECS components are user-owned storage indexed by entity id: SoA typed arrays.
const store = () => ({ value: new Float64Array(1 << 16) })

const spawnWith = (world: ReturnType<typeof createWorld>, ...components: Array<{ value: Float64Array }>): number => {
  const eid = addEntity(world)
  for (const component of components) {
    addComponent(world, eid, component)
    component.value[eid] = 1
  }
  return eid
}

const double = (world: ReturnType<typeof createWorld>, component: { value: Float64Array }) => {
  const entities = query(world, [component])
  const values = component.value
  for (let index = 0; index < entities.length; index++) values[entities[index]!]! *= 2
}

const swap = (world: ReturnType<typeof createWorld>, left: { value: Float64Array }, right: { value: Float64Array }) => {
  const entities = query(world, [left, right])
  for (let index = 0; index < entities.length; index++) {
    const eid = entities[index]!
    const value = left.value[eid]!
    left.value[eid] = right.value[eid]!
    right.value[eid] = value
  }
}

export const bitecs: Library = {
  packed_5: () => {
    const world = createWorld()
    const components = [store(), store(), store(), store(), store()]
    for (let index = 0; index < 1000; index++) spawnWith(world, ...components)
    return { run: () => { for (const component of components) double(world, component) } }
  },
  simple_iter: () => {
    const world = createWorld()
    const [A, B, C, D, E] = [store(), store(), store(), store(), store()] as const
    for (let index = 0; index < 1000; index++) {
      spawnWith(world, A, B)
      spawnWith(world, A, B, C)
      spawnWith(world, A, B, C, D)
      spawnWith(world, A, B, C, E)
    }
    return { run: () => { swap(world, A, B); swap(world, C, D); swap(world, C, E) } }
  },
  frag_iter: () => {
    const world = createWorld()
    const data = store()
    for (const _ of letters) {
      const tag = store()
      for (let index = 0; index < 100; index++) spawnWith(world, tag, data)
    }
    return { run: () => double(world, data) }
  },
  entity_cycle: () => {
    const world = createWorld()
    const A = store()
    const B = store()
    for (let index = 0; index < 1000; index++) spawnWith(world, A)
    return {
      run: () => {
        const sources = query(world, [A])
        for (let index = 0; index < sources.length; index++) spawnWith(world, B)
        const spawned = [...query(world, [B])]
        for (const eid of spawned) removeEntity(world, eid)
      }
    }
  },
  add_remove: () => {
    const world = createWorld()
    const A = store()
    const B = store()
    for (let index = 0; index < 1000; index++) spawnWith(world, A)
    return {
      run: () => {
        for (const eid of [...query(world, [A])]) addComponent(world, eid, B)
        for (const eid of [...query(world, [B])]) removeComponent(world, eid, B)
      }
    }
  },
  move: () => {
    const world = createWorld()
    const size = 100_001
    const Position = { x: new Float64Array(size), y: new Float64Array(size) }
    const Velocity = { x: new Float64Array(size), y: new Float64Array(size) }
    for (let index = 0; index < 100_000; index++) {
      const eid = addEntity(world)
      addComponent(world, eid, Position)
      addComponent(world, eid, Velocity)
      Velocity.x[eid] = 1
      Velocity.y[eid] = 2
    }
    return {
      run: () => {
        const entities = query(world, [Position, Velocity])
        for (let index = 0; index < entities.length; index++) {
          const eid = entities[index]!
          Position.x[eid]! += Velocity.x[eid]!
          Position.y[eid]! += Velocity.y[eid]!
        }
      }
    }
  }
}
