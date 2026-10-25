// Two copies of one world, fed the same seed, and two copies of a world whose
// gust system calls `Math.random()`. Balls bounce in a box and off each other,
// so the smallest difference grows. The exact pair draws every gust from a
// seeded `Random` kept in the world and turns angles with `Ops`; it stays the
// same bit for bit. The drifting pair splits at its first gust.
import { Descriptor, Ops, Random, Schema } from "@typeonce/ritmo"

export const BOX = 400
export const BALLS = 22
export const RADIUS = 14
/** The first gust, and how often one blows after it. */
export const FIRST_GUST = 60
export const GUST_EVERY = 30
export const LOOP = 600

export const Position = Descriptor.Component<{ x: number; y: number }>()("Drift/Position")
export const Velocity = Descriptor.Component<{ x: number; y: number }>()("Drift/Velocity")
export const Rng = Descriptor.ConstructedResource(Random.codec)("Drift/Rng")
export const Tick = Descriptor.Resource<number>()("Drift/Tick")

export const Game = Schema.bind(Schema.fragment({
  components: { Position, Velocity },
  resources: { Rng, Tick }
}))

const Balls = Game.Query({
  selection: { position: Game.Query.write(Position), velocity: Game.Query.write(Velocity) }
})

/** Lays the balls out on a grid with seeded speeds: both copies start alike. */
const Spawn = Game.System(
  "Drift/Spawn",
  {
    resources: { rng: Game.System.writeResource(Rng) },
    commands: Game.System.commands(Game.System.spawns(Position, Velocity))
  },
  ({ resources, commands }) => {
    const rng = Random.draw(resources.rng)
    for (let index = 0; index < BALLS; index++) {
      const angle = rng.range(0, 2 * Math.PI)
      commands.spawn(Game.Command.spawn(
        [Position, { x: 50 + (index % 6) * 60, y: 60 + Math.floor(index / 6) * 80 }],
        [Velocity, { x: Ops.cos(angle) * 2, y: Ops.sin(angle) * 2 }]
      ))
    }
  }
)

const Count = Game.System("Drift/Count", { resources: { tick: Game.System.writeResource(Tick) } }, ({ resources }) => {
  resources.tick.set(resources.tick.get() + 1)
})

const gusting = (tick: number) => tick >= FIRST_GUST && (tick - FIRST_GUST) % GUST_EVERY === 0

const push = (velocity: { x: number; y: number }, angle: number, cos: (a: number) => number, sin: (a: number) => number) => {
  const x = velocity.x + cos(angle) * 0.8
  const y = velocity.y + sin(angle) * 0.8
  const speed = Math.sqrt(x * x + y * y)
  const scale = speed > 3 ? 3 / speed : 1
  return { x: x * scale, y: y * scale }
}

/** Seeded and kept in the world: every copy draws the same angles. */
const SeededGust = Game.System(
  "Drift/SeededGust",
  {
    queries: { balls: Balls },
    resources: { rng: Game.System.writeResource(Rng), tick: Game.System.readResource(Tick) }
  },
  ({ queries, resources }) => {
    if (!gusting(resources.tick.get())) return
    const rng = Random.draw(resources.rng)
    for (const { data } of queries.balls.each()) {
      data.velocity.set(push(data.velocity.get(), rng.range(0, 2 * Math.PI), Ops.cos, Ops.sin))
    }
  }
)

/** The same gust from `Math.random()`: each copy rolls its own angles. */
const UnseededGust = Game.System(
  "Drift/UnseededGust",
  { queries: { balls: Balls }, resources: { tick: Game.System.readResource(Tick) } },
  ({ queries, resources }) => {
    if (!gusting(resources.tick.get())) return
    for (const { data } of queries.balls.each()) {
      // oxlint-disable-next-line ritmo/use-random-for-randomness -- the demo's point: this copy drifts
      const angle = Math.random() * 2 * Math.PI
      data.velocity.set(push(data.velocity.get(), angle, Ops.cos, Ops.sin))
    }
  }
)

/** Moves the balls, bounces them off the walls and off each other. */
const Bounce = Game.System("Drift/Bounce", { queries: { balls: Balls } }, ({ queries }) => {
  const balls = queries.balls.each().map(({ data }) => ({ data, p: { ...data.position.get() }, v: { ...data.velocity.get() } }))
  for (const ball of balls) {
    ball.p.x += ball.v.x
    ball.p.y += ball.v.y
    if (ball.p.x < RADIUS || ball.p.x > BOX - RADIUS) ball.v.x = -ball.v.x
    if (ball.p.y < RADIUS || ball.p.y > BOX - RADIUS) ball.v.y = -ball.v.y
    ball.p.x = Math.min(BOX - RADIUS, Math.max(RADIUS, ball.p.x))
    ball.p.y = Math.min(BOX - RADIUS, Math.max(RADIUS, ball.p.y))
  }
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i]!
      const b = balls[j]!
      const dx = b.p.x - a.p.x
      const dy = b.p.y - a.p.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance === 0 || distance >= RADIUS * 2) continue
      const nx = dx / distance
      const ny = dy / distance
      const along = (b.v.x - a.v.x) * nx + (b.v.y - a.v.y) * ny
      if (along < 0) {
        a.v.x += along * nx
        a.v.y += along * ny
        b.v.x -= along * nx
        b.v.y -= along * ny
      }
      const overlap = (RADIUS * 2 - distance) / 2
      a.p.x -= nx * overlap
      a.p.y -= ny * overlap
      b.p.x += nx * overlap
      b.p.y += ny * overlap
    }
  }
  for (const ball of balls) {
    ball.data.position.set(ball.p)
    ball.data.velocity.set(ball.v)
  }
})

export const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
export const exact = Game.Schedule(Count, SeededGust, Bounce)
export const drifting = Game.Schedule(Count, UnseededGust, Bounce)

const ReadBalls = Game.Inspector(
  "Drift/Read",
  { queries: { balls: Game.Query({ selection: { position: Game.Query.read(Position) } }) } },
  ({ queries }) => queries.balls.each().map(({ data }) => data.position.get())
)

/** FNV-1a over the bits of every position, as 8 hex digits. */
const hash = (positions: ReadonlyArray<{ readonly x: number; readonly y: number }>) => {
  const values = new Float64Array(positions.length * 2)
  positions.forEach((position, index) => {
    values[index * 2] = position.x
    values[index * 2 + 1] = position.y
  })
  let state = 0x811c9dc5
  for (const byte of new Uint8Array(values.buffer)) state = Math.imul(state ^ byte, 0x01000193) >>> 0
  return state.toString(16).padStart(8, "0")
}

export type Kind = "exact" | "drifting"

/** One copy of the world: the seed is the same for every copy. */
export const makeWorld = (kind: Kind) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: { Rng: Random.seed(2026), Tick: 0 }
  })
  if (!made.ok) throw new Error("The determinism demo could not build the world.")
  const runtime = made.value
  runtime.tick(setup)
  const update = kind === "exact" ? exact : drifting
  return {
    step: () => {
      const ticked = runtime.tick(update)
      if (!ticked.ok) throw new Error("The determinism demo failed a tick.")
    },
    read: () => {
      const balls = runtime.inspect(ReadBalls)
      return { balls, checksum: hash(balls) }
    }
  }
}

/** Two copies of one kind, stepped together, with the first tick they differ on. */
export const makePair = (kind: Kind) => {
  const copies = [makeWorld(kind), makeWorld(kind)] as const
  let tick = 0
  let differsSince: number | null = null
  return {
    step: () => {
      copies[0].step()
      copies[1].step()
      tick++
      if (differsSince === null && copies[0].read().checksum !== copies[1].read().checksum) differsSince = tick
    },
    read: () => ({ tick, differsSince, copies: [copies[0].read(), copies[1].read()] as const })
  }
}
