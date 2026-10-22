/**
 * Runtime benchmark cases for render sync systems.
 *
 * The systems run every frame, after the simulation. Nodes are plain objects
 * in a registry over an array layer, so the cases measure the sync
 * bookkeeping (change detection, registry lookups, callbacks) and not any
 * renderer.
 */
import { Descriptor, Schema } from "@typeonce/ritmo"
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"
import type { BenchCase } from "../../core/bench/harness.ts"

const N = 10_000

class Node {
  x = 0
  y = 0
  frame = 0
  attached = true
}

const layer = () => {
  let attached = 0
  return NodeRegistry.make<Node>({
    attach: () => {
      attached++
    },
    detach: (node) => {
      attached--
      node.attached = false
    }
  })
}

const Position = Descriptor.Component<{ x: number; y: number }>()("RenderBench/Position")
const Previous = Descriptor.Component<{ x: number; y: number }>()("RenderBench/Previous")
const Frame = Descriptor.Component<number>()("RenderBench/Frame")
const Sprite = Descriptor.Component<{ texture: string }>()("RenderBench/Sprite")
const Nodes = Descriptor.Service<NodeRegistry.NodeRegistry<Node>>()("RenderBench/Nodes")
const Clock = Descriptor.Service<{ alpha: number }>()("RenderBench/Clock")

const Game = Schema.bind(Schema.fragment({ components: { Position, Previous, Frame, Sprite } }))

const Sync = RenderSync.system(Game, {
  name: "RenderBench/Sync",
  renderable: Sprite,
  transform: Position,
  registry: Nodes,
  redrawOn: [Frame],
  create: () => new Node(),
  apply: (node, { transform }) => {
    node.x = transform.x
    node.y = transform.y
  }
})

const Interpolate = RenderSync.interpolate(Game, {
  name: "RenderBench/Interpolate",
  registry: Nodes,
  previous: Previous,
  current: Position,
  clock: Clock,
  place: (node, { x, y }) => {
    node.x = x
    node.y = y
  }
})

const makeRuntime = () => Game.Runtime.make({
  services: Game.Runtime.services(
    Game.Runtime.service(Nodes, layer()),
    Game.Runtime.service(Clock, { alpha: 0.5 })
  )
}).success

const SpawnSprites = (count: number) => Game.System("RenderBench/SpawnSprites", { commands: Game.System.commands(Game.System.spawns(Position, Previous, Frame, Sprite)) }, ({ commands }) => {
  for (let index = 0; index < count; index++) {
    commands.spawn(Game.Command.spawn(
      [Position, { x: index, y: index }],
      [Previous, { x: index, y: index }],
      [Frame, 0],
      [Sprite, { texture: "hero" }]
    ))
  }
})

const Movers = Game.Query({
  selection: { position: Game.Query.write(Position) }
})

const changed: BenchCase = {
  name: "render/sync-1k-changed-of-10k",
  description: "Sync 10k rendered entities after 1k of them moved",
  setup: () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(SpawnSprites(N), Game.Schedule.applyDeferred(), Sync))
    let frame = 0
    const Move = Game.System("RenderBench/Move", { queries: { movers: Movers } }, ({ queries }) => {
      frame++
      let index = 0
      for (const { data } of queries.movers.each()) {
        if (index++ % 10 === frame % 10) {
          data.position.update((position) => ({ x: position.x + 1, y: position.y }))
        }
      }
    })
    const schedule = Game.Schedule(Move, Sync)
    return { run: () => runtime.tick(schedule) }
  }
}

const churn: BenchCase = {
  name: "render/sync-spawn-despawn-500",
  description: "Sync nodes for 500 spawns and 500 despawns in a world of 5k rendered entities",
  setup: () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(SpawnSprites(5_000), Game.Schedule.applyDeferred(), Sync))
    const Rendered = Game.Query({ selection: { sprite: Game.Query.read(Sprite) } })
    const Despawn = Game.System("RenderBench/Despawn", { queries: { rendered: Rendered }, commands: Game.System.commands(Game.System.despawns(Sprite)) }, ({ queries, commands }) => {
      let count = 0
      for (const { entity } of queries.rendered.each()) {
        if (count++ === 500) break
        commands.despawn(entity)
      }
    })
    const schedule = Game.Schedule(Despawn, SpawnSprites(500), Game.Schedule.applyDeferred(), Sync)
    return { run: () => runtime.tick(schedule) }
  }
}

const interpolate: BenchCase = {
  name: "render/interpolate-10k",
  description: "Place 10k nodes between their previous and current positions",
  setup: () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(SpawnSprites(N), Game.Schedule.applyDeferred(), Sync))
    const schedule = Game.Schedule(Interpolate)
    return { run: () => runtime.tick(schedule) }
  }
}

export const cases: ReadonlyArray<BenchCase> = [
  changed,
  churn,
  interpolate
]
