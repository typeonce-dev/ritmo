/**
 * A headless chase in a walled room, showing the math package's hot-path
 * helpers inside ECS systems:
 *
 * - `Random` spawns the chasers from a state kept in a resource.
 * - `FlowField` leads every chaser around the wall to the player (one search
 *   for all of them), `SpatialGrid` finds nearby chasers to keep apart from,
 *   and `Collide2.moveCircle` slides them along the walls.
 * - Shots sweep against the walls and the chasers, so a fast shot hits the
 *   first thing on its path instead of skipping past it.
 */
import { Collide2, FlowField, Random, Scalar, SpatialGrid, Vec2 } from "@typeonce/ritmo-math"
import { Body, Chaser, Frame, Game, Hits, Player, Position, Rng, Shot, Walls } from "./schema.ts"

const positive = (value: number): Scalar.Positive => {
  const checked = Scalar.Positive.result(value)
  // Authored constants below: a failure is a typo in this file.
  if (checked._tag === "Failure") throw new Error(`Not a positive cell size: ${value}`)
  return checked.success
}

/** A 600 × 400 room with a wall down the middle, open at the bottom. */
export const room = [
  { minX: -20, minY: -20, maxX: 620, maxY: 0 },
  { minX: -20, minY: 400, maxX: 620, maxY: 420 },
  { minX: -20, minY: 0, maxX: 0, maxY: 400 },
  { minX: 600, minY: 0, maxX: 620, maxY: 400 },
  { minX: 290, minY: 0, maxX: 310, maxY: 300 }
] as const

const chaser = { radius: 10, speed: 120 }

const Spawn = Game.System("Algorithms/Spawn", {
  resources: { rng: Game.System.writeResource(Rng) },
  commands: Game.System.commands(Game.System.spawns(Position, Body, Player, Chaser))
}, ({ resources, commands }) => {
  const random = Random.draw(resources.rng)
  commands.spawn(Game.Command.spawn([Position, { x: 450, y: 100 }], [Body, { radius: 12, speed: 0 }], [Player, {}]))
  for (let index = 0; index < 8; index++) {
    const at = { x: random.range(40, 250), y: random.range(40, 300) }
    commands.spawn(Game.Command.spawn([Position, at], [Body, chaser], [Chaser, {}]))
  }
})

const Chase = Game.System("Algorithms/Chase", {
  local: () => ({ paths: FlowField.make(positive(20)), grid: SpatialGrid.make(positive(32)), bodies: new Array<Vec2.Vec2>() }),
  queries: {
    chasers: Game.Query({ selection: { position: Game.Query.write(Position), body: Game.Query.read(Body) }, with: [Chaser] }),
    player: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Player] })
  },
  resources: { walls: Game.System.readResource(Walls) },
  services: { frame: Game.System.service(Frame) }
}, ({ queries, resources, services, local }) => {
  const player = queries.player.each()[0]?.data.position.get()
  if (player === undefined) return
  const walls = resources.walls.get()
  const { paths, grid, bodies } = local
  // Both calls are free when the walls and the player's cell did not change.
  paths.setWalls(walls, chaser.radius)
  paths.setGoal(player)
  grid.clear()
  bodies.length = 0
  for (const { data } of queries.chasers.each()) {
    const at = data.position.get()
    grid.insert(bodies.length, at.x, at.y, data.body.get().radius)
    bodies.push(at)
  }
  let index = 0
  for (const { data } of queries.chasers.each()) {
    const at = data.position.get()
    const { radius, speed } = data.body.get()
    // Toward the player around the walls, or straight at her where the field has no way.
    let way = paths.way(at) ?? Vec2.normalizeOr(Vec2.subtract(player, at), Vec2.zero)
    // Keep apart from chasers closer than two radii.
    const self = index++
    grid.forEachIn(at.x - radius * 2, at.y - radius * 2, at.x + radius * 2, at.y + radius * 2, (other) => {
      if (other === self) return
      const away = Vec2.subtract(at, bodies[other]!)
      const distance = Vec2.length(away)
      if (distance < radius * 2) way = Vec2.add(way, Vec2.scale(Vec2.normalizeOr(away, Vec2.zero), (radius * 2 - distance) / (radius * 2)))
    })
    const moved = Collide2.moveCircle(at, Vec2.scale(Vec2.clampLength(way, 1), speed * services.frame.dt), radius, walls)
    data.position.set(moved.position)
  }
})

const MoveShots = Game.System("Algorithms/MoveShots", {
  queries: {
    shots: Game.Query({ selection: { position: Game.Query.write(Position), shot: Game.Query.read(Shot) } }),
    chasers: Game.Query({ selection: { position: Game.Query.read(Position), body: Game.Query.read(Body) }, with: [Chaser] })
  },
  resources: { walls: Game.System.readResource(Walls), hits: Game.System.writeResource(Hits) },
  services: { frame: Game.System.service(Frame) },
  commands: Game.System.commands(Game.System.despawns(Shot))
}, ({ queries, resources, services, commands }) => {
  const walls = resources.walls.get()
  for (const { entity, data } of queries.shots.each()) {
    const at = data.position.get()
    const { velocity, radius } = data.shot.get()
    const delta = Vec2.scale(velocity, services.frame.dt)
    // The earliest contact along the whole step wins.
    let first: { kind: "wall" | "chaser"; time: number } | undefined
    const wall = Collide2.sweepCircleBoxes(at, delta, radius, walls)
    if (wall !== undefined) first = { kind: "wall", time: wall.time }
    for (const target of queries.chasers.each()) {
      const time = Collide2.sweepCircleCircle(at, delta, radius, target.data.position.get(), target.data.body.get().radius)
      if (time !== undefined && (first === undefined || time < first.time)) first = { kind: "chaser", time }
    }
    if (first === undefined) {
      data.position.set(Vec2.add(at, delta))
      continue
    }
    const hit = { shot: entity.id, ...first }
    resources.hits.update((hits) => [...hits, hit])
    commands.despawn(entity)
  }
})

/** The world after `seed`'s spawn, ready to step. */
export const makeSimulation = (seed: number) => {
  const frame = { dt: 0 }
  const made = Game.Runtime.make({
    resources: { Rng: Random.seed(seed), Walls: room, Hits: [] },
    services: Game.Runtime.services(Game.Runtime.service(Frame, frame))
  })
  // Random.seed always gives a valid state; the Result covers validated resources in general.
  if (made._tag === "Failure") throw new Error("the random state did not validate")
  const runtime = made.success
  const spawned = runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
  if (spawned._tag === "Failure") throw new Error("spawning failed")
  const update = Game.Schedule(Chase, MoveShots, Game.Schedule.applyDeferred())
  return {
    runtime,
    /** Fires a shot from `at` with `velocity` (units per second); the tick's Result says whether it spawned. */
    fire: (at: Vec2.Vec2, velocity: Vec2.Vec2) => {
      const Fire = Game.System("Algorithms/Fire", {
        commands: Game.System.commands(Game.System.spawns(Position, Shot))
      }, ({ commands }) => {
        commands.spawn(Game.Command.spawn([Position, at], [Shot, { velocity, radius: 3 }]))
      })
      return runtime.tick(Game.Schedule(Fire, Game.Schedule.applyDeferred()))
    },
    step: (dt: number) => {
      frame.dt = dt
      return runtime.tick(update)
    }
  }
}

export const ReadWorld = Game.Inspector("Algorithms/ReadWorld", {
  queries: {
    chasers: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Chaser] }),
    player: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Player] })
  },
  resources: { hits: Game.System.readResource(Hits), rng: Game.System.readResource(Rng) }
}, ({ queries, resources }) => ({
  chasers: queries.chasers.each().map(({ data }) => data.position.get()),
  player: queries.player.each()[0]!.data.position.get(),
  hits: resources.hits.get(),
  rng: resources.rng.get()
}))
