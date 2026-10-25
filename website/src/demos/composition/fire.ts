// A village fire, made of components. Nothing scripts it: four small systems
// each read and change what villagers hold, and the fire comes out of that.
// - Wander: villagers without Burning stroll.
// - Spread: a villager near a Burning one, and not Wet, gains Burning.
// - Panic: a Burning villager runs for the fountain.
// - Douse: Burning at the fountain is removed, and Wet inserted.
// Hiss hears each removal of Burning once, for the page's output.
import { Descriptor, Ops, Random, Schema } from "@typeonce/ritmo"

export const Position = Descriptor.Component<{ x: number; y: number }>()("Fire/Position")
export const Velocity = Descriptor.Component<{ x: number; y: number }>()("Fire/Velocity")
export const Villager = Descriptor.Component<{ id: number }>()("Fire/Villager")
export const Burning = Descriptor.Tag("Fire/Burning")
export const Wet = Descriptor.Tag("Fire/Wet")
export const Spark = Descriptor.Event<{ readonly id: number }>()("Fire/Spark")
/** What each rule did this tick, so the host can light it up. */
export const Fired = Descriptor.Resource<{ readonly spread: number; readonly douse: number }>()("Fire/Fired")
/** How many removals of Burning Hiss has heard. */
export const Heard = Descriptor.Resource<{ readonly count: number }>()("Fire/Heard")
export const Rng = Descriptor.ConstructedResource(Random.codec)("Fire/Rng")

export const Game = Schema.bind(Schema.fragment({
  components: { Position, Velocity, Villager, Burning, Wet },
  events: { Spark },
  resources: { Fired, Heard, Rng }
}))

export const AREA = { width: 600, height: 420 } as const
export const FOUNTAIN = { x: 540, y: 210, radius: 44 } as const
export const VILLAGERS = 34
/** How close fire has to come to catch. */
export const REACH = 28
const STROLL = 0.5
const RUN = 1.2

const Spawn = Game.System(
  "Fire/Spawn",
  {
    resources: { rng: Game.System.writeResource(Rng) },
    commands: Game.System.commands(Game.System.spawns(Position, Velocity, Villager))
  },
  ({ resources, commands }) => {
    const rng = Random.draw(resources.rng)
    for (let id = 0; id < VILLAGERS; id++) {
      // The first villager starts at the far left, where the spark lands
      const x = id === 0 ? 40 : rng.range(70, FOUNTAIN.x - FOUNTAIN.radius - 30)
      const y = id === 0 ? AREA.height / 2 : rng.range(30, AREA.height - 30)
      const angle = rng.range(0, 2 * Math.PI)
      commands.spawn(Game.Command.spawn(
        [Villager, { id }],
        [Position, { x, y }],
        [Velocity, { x: Ops.cos(angle) * STROLL, y: Ops.sin(angle) * STROLL }]
      ))
    }
  }
)

const Ignite = Game.System(
  "Fire/Ignite",
  {
    queries: { villagers: Game.Query({ selection: { villager: Game.Query.read(Villager) } }) },
    events: { sparks: Game.System.readEvent(Spark) },
    commands: Game.System.commands(Game.System.inserts(Burning))
  },
  ({ queries, events, commands }) => {
    for (const spark of events.sparks.all()) {
      for (const { entity, data } of queries.villagers.each()) {
        if (data.villager.get().id === spark.id) commands.insert(entity, [Burning, {}])
      }
    }
  }
)

const Wander = Game.System(
  "Fire/Wander",
  {
    queries: {
      strolling: Game.Query({
        selection: { position: Game.Query.write(Position), velocity: Game.Query.write(Velocity) },
        without: [Burning]
      })
    }
  },
  ({ queries }) => {
    for (const { data } of queries.strolling.each()) {
      const { x, y } = data.position.get()
      let { x: vx, y: vy } = data.velocity.get()
      if (x + vx < 20 || x + vx > AREA.width - 20) vx = -vx
      if (y + vy < 20 || y + vy > AREA.height - 20) vy = -vy
      data.velocity.set({ x: vx, y: vy })
      data.position.set({ x: x + vx, y: y + vy })
    }
  }
)

const Spread = Game.System(
  "Fire/Spread",
  {
    queries: {
      burning: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Burning] }),
      dry: Game.Query({ selection: { position: Game.Query.read(Position) }, without: [Burning, Wet] })
    },
    resources: { fired: Game.System.writeResource(Fired) },
    commands: Game.System.commands(Game.System.inserts(Burning))
  },
  ({ queries, resources, commands }) => {
    const fires = queries.burning.each().map(({ data }) => data.position.get())
    let caught = 0
    for (const { entity, data } of queries.dry.each()) {
      const { x, y } = data.position.get()
      if (fires.some((fire) => (fire.x - x) ** 2 + (fire.y - y) ** 2 < REACH * REACH)) {
        commands.insert(entity, [Burning, {}])
        caught++
      }
    }
    resources.fired.update((fired) => ({ ...fired, spread: caught }))
  }
)

const Panic = Game.System(
  "Fire/Panic",
  { queries: { burning: Game.Query({ selection: { position: Game.Query.write(Position) }, with: [Burning] }) } },
  ({ queries }) => {
    for (const { data } of queries.burning.each()) {
      const { x, y } = data.position.get()
      const dx = FOUNTAIN.x - x
      const dy = FOUNTAIN.y - y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance > 1) data.position.set({ x: x + (dx / distance) * RUN, y: y + (dy / distance) * RUN })
    }
  }
)

const Douse = Game.System(
  "Fire/Douse",
  {
    queries: { burning: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Burning] }) },
    resources: { fired: Game.System.writeResource(Fired) },
    commands: Game.System.commands(Game.System.removes(Burning), Game.System.inserts(Wet))
  },
  ({ queries, resources, commands }) => {
    let doused = 0
    for (const { entity, data } of queries.burning.each()) {
      const { x, y } = data.position.get()
      if ((FOUNTAIN.x - x) ** 2 + (FOUNTAIN.y - y) ** 2 < FOUNTAIN.radius ** 2) {
        commands.remove(entity, Burning)
        commands.insert(entity, [Wet, {}])
        doused++
      }
    }
    resources.fired.update((fired) => ({ ...fired, douse: doused }))
  }
)

/** Hears each removal of Burning once: per reader, since its own last run. */
const Hiss = Game.System(
  "Fire/Hiss",
  {
    removed: { doused: Game.System.readRemoved(Burning) },
    resources: { heard: Game.System.writeResource(Heard) }
  },
  ({ removed, resources }) => {
    const count = removed.doused.all().length
    if (count > 0) resources.heard.update((heard) => ({ count: heard.count + count }))
  }
)

export const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
export const update = Game.Schedule(Ignite, Wander, Panic, Spread, Douse, Game.Schedule.applyDeferred(), Hiss)

export const ReadVillage = Game.Inspector(
  "Fire/Read",
  {
    queries: {
      villagers: Game.Query({
        selection: {
          villager: Game.Query.read(Villager),
          position: Game.Query.read(Position),
          burning: Game.Query.optional(Burning),
          wet: Game.Query.optional(Wet)
        }
      })
    },
    resources: { fired: Game.System.readResource(Fired), heard: Game.System.readResource(Heard) }
  },
  ({ queries, resources }) => ({
    villagers: queries.villagers.each().map(({ data }) => ({
      id: data.villager.get().id,
      ...data.position.get(),
      burning: data.burning.present,
      wet: data.wet.present
    })),
    fired: resources.fired.get(),
    heard: resources.heard.get().count
  })
)

/** When the spark lands, in frames. */
export const SPARK_AT = 90

export const makeVillage = () => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: { Fired: { spread: 0, douse: 0 }, Heard: { count: 0 }, Rng: Random.seed(7) }
  })
  if (!made.ok) throw new Error("The village could not be built.")
  const runtime = made.value
  runtime.tick(setup)
  let frame = 0
  return {
    step: () => {
      frame++
      if (frame === SPARK_AT) runtime.send(Spark, { id: 0 })
      const ticked = runtime.tick(update)
      if (!ticked.ok) throw new Error("The village failed a tick.")
    },
    read: () => runtime.inspect(ReadVillage)
  }
}
