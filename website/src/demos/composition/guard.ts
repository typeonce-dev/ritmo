// Four guards, one idea: what an entity has decides which systems touch it.
// Move reads every Guard without Stunned. A hit inserts Stunned, so Move
// skips that guard and it stops, with no `if` in Move. When Stunned is
// removed, Move picks the guard up again and Recover hears the removal once.
import { Descriptor, Schema } from "@typeonce/ritmo"

export const Position = Descriptor.Component<{ x: number }>()("Guard/Position")
export const Velocity = Descriptor.Component<{ x: number }>()("Guard/Velocity")
export const Guard = Descriptor.Component<{ lane: number }>()("Guard/Guard")
export const Stunned = Descriptor.Component<{ frames: number }>()("Guard/Stunned")
export const Hit = Descriptor.Event<{ readonly lane: number; readonly frames: number }>()("Guard/Hit")
/** How many removals of Stunned Recover has heard, for the page's output. */
export const Heard = Descriptor.Resource<{ readonly count: number }>()("Guard/Heard")

export const Game = Schema.bind(Schema.fragment({
  components: { Position, Velocity, Guard, Stunned },
  events: { Hit },
  resources: { Heard }
}))

/** The patrol: each guard turns at these edges. */
export const EDGES = { min: 0, max: 1000 } as const
export const LANES = 4
const START = [
  { x: 120, vx: 3 },
  { x: 640, vx: -2.4 },
  { x: 360, vx: 2.7 },
  { x: 880, vx: -3.2 }
] as const

const Spawn = Game.System(
  "Guard/Spawn",
  { commands: Game.System.commands(Game.System.spawns(Position, Velocity, Guard)) },
  ({ commands }) => {
    START.forEach((start, lane) => {
      commands.spawn(Game.Command.spawn([Guard, { lane }], [Position, { x: start.x }], [Velocity, { x: start.vx }]))
    })
  }
)

const Stun = Game.System(
  "Guard/Stun",
  {
    queries: { guards: Game.Query({ selection: { guard: Game.Query.read(Guard) }, without: [Stunned] }) },
    events: { hits: Game.System.readEvent(Hit) },
    commands: Game.System.commands(Game.System.inserts(Stunned))
  },
  ({ queries, events, commands }) => {
    for (const hit of events.hits.all()) {
      for (const { entity, data } of queries.guards.each()) {
        if (data.guard.get().lane === hit.lane) commands.insert(entity, [Stunned, { frames: hit.frames }])
      }
    }
  }
)

const WearOff = Game.System(
  "Guard/WearOff",
  {
    queries: { stunned: Game.Query({ selection: { stunned: Game.Query.write(Stunned) } }) },
    commands: Game.System.commands(Game.System.removes(Stunned))
  },
  ({ queries, commands }) => {
    for (const { entity, data } of queries.stunned.each()) {
      const frames = data.stunned.get().frames - 1
      if (frames <= 0) commands.remove(entity, Stunned)
      else data.stunned.set({ frames })
    }
  }
)

/** Moves every guard that is not stunned: the query says so, Move has no `if`. */
const Move = Game.System(
  "Guard/Move",
  {
    queries: {
      walking: Game.Query({
        selection: { position: Game.Query.write(Position), velocity: Game.Query.write(Velocity) },
        with: [Guard],
        without: [Stunned]
      })
    }
  },
  ({ queries }) => {
    for (const { data } of queries.walking.each()) {
      const { x } = data.position.get()
      let { x: vx } = data.velocity.get()
      if (x + vx < EDGES.min || x + vx > EDGES.max) vx = -vx
      data.velocity.set({ x: vx })
      data.position.set({ x: x + vx })
    }
  }
)

/** Hears each removal of Stunned once: per reader, since its own last run. */
const Recover = Game.System(
  "Guard/Recover",
  {
    removed: { recovered: Game.System.readRemoved(Stunned) },
    resources: { heard: Game.System.writeResource(Heard) }
  },
  ({ removed, resources }) => {
    const count = removed.recovered.all().length
    if (count > 0) resources.heard.update((heard) => ({ count: heard.count + count }))
  }
)

export const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
// Commands land at applyDeferred(): on the hit's own tick the guard still
// moves, and from the next one Move skips it, as the page's snippet shows.
export const update = Game.Schedule(Stun, WearOff, Move, Game.Schedule.applyDeferred(), Recover)

const Seen = Game.Query({
  selection: {
    guard: Game.Query.read(Guard),
    position: Game.Query.read(Position),
    stunned: Game.Query.optional(Stunned)
  }
})

export const ReadGuards = Game.Inspector(
  "Guard/Read",
  { queries: { guards: Seen }, resources: { heard: Game.System.readResource(Heard) } },
  ({ queries, resources }) => ({
    guards: queries.guards
      .each()
      .map(({ data }) => ({
        lane: data.guard.get().lane,
        x: data.position.get().x,
        stunned: data.stunned.present ? data.stunned.get().frames : null
      }))
      .sort((a, b) => a.lane - b.lane),
    heard: resources.heard.get().count
  })
)

/** Stun length, and the script of hits: one every HIT_EVERY frames, lanes in this order. */
export const STUN = 210
export const HIT_EVERY = 110
const ORDER = [1, 3, 0, 2, 1, 0, 3, 2] as const
/** The lane hit on this frame, if any. */
export const hitAt = (frame: number): number | null =>
  frame > 0 && frame % HIT_EVERY === 0 ? ORDER[(frame / HIT_EVERY - 1) % ORDER.length]! : null

export const makeGuards = () => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Heard: { count: 0 } } })
  if (!made.ok) throw new Error("The guard demo could not build the world.")
  const runtime = made.value
  runtime.tick(setup)
  let frame = 0
  return {
    /** One tick, sending the scripted hit first. Returns the lane hit, if any. */
    step: () => {
      frame++
      const lane = hitAt(frame)
      if (lane !== null) runtime.send(Hit, { lane, frames: STUN })
      const ticked = runtime.tick(update)
      if (!ticked.ok) throw new Error("The guard demo failed a tick.")
      return lane
    },
    read: () => runtime.inspect(ReadGuards)
  }
}
