// One guard, one idea: what an entity has decides which systems touch it.
// Move reads every Guard without Stunned. A hit inserts Stunned, so Move
// skips the guard and it stops, with no `if` in Move. When Stunned is
// removed, Move picks the guard up again and Recover hears the removal once.
import { Descriptor, Schema } from "@typeonce/ritmo"

export const Position = Descriptor.Component<{ x: number }>()("Guard/Position")
export const Velocity = Descriptor.Component<{ x: number }>()("Guard/Velocity")
export const Guard = Descriptor.Tag("Guard/Guard")
export const Stunned = Descriptor.Component<{ frames: number }>()("Guard/Stunned")
export const Hit = Descriptor.Event<{ readonly frames: number }>()("Guard/Hit")
/** What the host draws: which systems ran on the guard this tick, and how often Recover heard a removal. */
export const Ran = Descriptor.Resource<{ readonly move: boolean; readonly heard: number }>()("Guard/Ran")

export const Game = Schema.bind(Schema.fragment({
  components: { Position, Velocity, Guard, Stunned },
  events: { Hit },
  resources: { Ran }
}))

/** The patrol: the guard turns at these edges. */
export const EDGES = { min: 120, max: 840 } as const

const Spawn = Game.System(
  "Guard/Spawn",
  { commands: Game.System.commands(Game.System.spawns(Position, Velocity, Guard)) },
  ({ commands }) => {
    commands.spawn(Game.Command.spawn([Guard, {}], [Position, { x: 480 }], [Velocity, { x: 2 }]))
  }
)

const Stun = Game.System(
  "Guard/Stun",
  {
    queries: { guards: Game.Query({ selection: {}, with: [Guard], without: [Stunned] }) },
    events: { hits: Game.System.readEvent(Hit) },
    commands: Game.System.commands(Game.System.inserts(Stunned))
  },
  ({ queries, events, commands }) => {
    for (const hit of events.hits.all()) {
      for (const match of queries.guards.each()) commands.insert(match.entity, [Stunned, { frames: hit.frames }])
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
    },
    resources: { ran: Game.System.writeResource(Ran) }
  },
  ({ queries, resources }) => {
    let moved = false
    for (const { data } of queries.walking.each()) {
      moved = true
      const { x } = data.position.get()
      let { x: vx } = data.velocity.get()
      if (x + vx < EDGES.min || x + vx > EDGES.max) vx = -vx
      data.velocity.set({ x: vx })
      data.position.set({ x: x + vx })
    }
    resources.ran.update((ran) => ({ ...ran, move: moved }))
  }
)

/** Hears each removal of Stunned once: per reader, since its own last run. */
const Recover = Game.System(
  "Guard/Recover",
  {
    removed: { recovered: Game.System.readRemoved(Stunned) },
    resources: { ran: Game.System.writeResource(Ran) }
  },
  ({ removed, resources }) => {
    const count = removed.recovered.all().length
    if (count > 0) resources.ran.update((ran) => ({ ...ran, heard: ran.heard + count }))
  }
)

export const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
// Commands land at applyDeferred(): on the hit's own tick the guard still
// moves, and from the next one Move skips it, as the page's snippet shows.
export const update = Game.Schedule(Stun, WearOff, Move, Game.Schedule.applyDeferred(), Recover)

const Seen = Game.Query({
  selection: { position: Game.Query.read(Position), stunned: Game.Query.optional(Stunned) },
  with: [Guard]
})

export const ReadGuard = Game.Inspector(
  "Guard/Read",
  { queries: { guard: Seen }, resources: { ran: Game.System.readResource(Ran) } },
  ({ queries, resources }) => {
    const found = queries.guard.each()[0]
    return {
      x: found?.data.position.get().x ?? 480,
      stunned: found !== undefined && found.data.stunned.present ? found.data.stunned.get().frames : null,
      ran: resources.ran.get()
    }
  }
)

export const makeGuard = () => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Ran: { move: false, heard: 0 } } })
  if (!made.ok) throw new Error("The guard demo could not build the world.")
  const runtime = made.value
  runtime.tick(setup)
  return {
    hit: (frames: number) => runtime.send(Hit, { frames }),
    step: () => {
      const ticked = runtime.tick(update)
      if (!ticked.ok) throw new Error("The guard demo failed a tick.")
    },
    read: () => runtime.inspect(ReadGuard)
  }
}
