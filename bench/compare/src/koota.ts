import { createWorld, trait } from "koota"
import { letters, type Library } from "./cases.ts"

// Koota's schema traits are stored SoA; `useStores` is its fastest iteration path.
const value = () => trait({ value: 1 })
export const koota: Library = {
  packed_5: () => {
    const world = createWorld()
    const traits = [value(), value(), value(), value(), value()]
    for (let index = 0; index < 1000; index++) world.spawn(...traits)
    return {
      run: () => {
        for (const component of traits) {
          world.query(component).useStores(([store], entities) => {
            const values = store.value
            for (const entity of entities) values[entity.id()]! *= 2
          })
        }
      }
    }
  },
  simple_iter: () => {
    const world = createWorld()
    const [A, B, C, D, E] = [value(), value(), value(), value(), value()] as const
    for (let index = 0; index < 1000; index++) {
      world.spawn(A, B)
      world.spawn(A, B, C)
      world.spawn(A, B, C, D)
      world.spawn(A, B, C, E)
    }
    const swap = (left: typeof A, right: typeof A) =>
      world.query(left, right).useStores(([l, r], entities) => {
        const lv = l.value
        const rv = r.value
        for (const entity of entities) {
          const id = entity.id()
          const v = lv[id]!
          lv[id] = rv[id]!
          rv[id] = v
        }
      })
    return { run: () => { swap(A, B); swap(C, D); swap(C, E) } }
  },
  frag_iter: () => {
    const world = createWorld()
    const Data = value()
    for (const _ of letters) {
      const tag = trait()
      for (let index = 0; index < 100; index++) world.spawn(tag, Data)
    }
    return {
      run: () => world.query(Data).useStores(([store], entities) => {
        const values = store.value
        for (const entity of entities) values[entity.id()]! *= 2
      })
    }
  },
  entity_cycle: () => {
    const world = createWorld()
    const A = value()
    const B = value()
    for (let index = 0; index < 1000; index++) world.spawn(A)
    return {
      run: () => {
        for (const _ of world.query(A)) world.spawn(B)
        for (const entity of [...world.query(B)]) entity.destroy()
      }
    }
  },
  add_remove: () => {
    const world = createWorld()
    const A = value()
    const B = value()
    for (let index = 0; index < 1000; index++) world.spawn(A)
    return {
      run: () => {
        for (const entity of [...world.query(A)]) entity.add(B)
        for (const entity of [...world.query(B)]) entity.remove(B)
      }
    }
  },
  move: () => {
    const world = createWorld()
    const Position = trait({ x: 0, y: 0 })
    const Velocity = trait({ x: 1, y: 2 })
    for (let index = 0; index < 100_000; index++) world.spawn(Position, Velocity)
    return {
      run: () => {
        world.query(Position, Velocity).useStores(([position, velocity], entities) => {
          const { x: px, y: py } = position
          const { x: vx, y: vy } = velocity
          for (const entity of entities) {
            const id = entity.id()
            px[id]! += vx[id]!
            py[id]! += vy[id]!
          }
        })
      }
    }
  }
}
