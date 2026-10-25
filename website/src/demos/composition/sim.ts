// One small arena, three stories, one world. A guard is stunned by a hit (a
// `Stunned` component inserted by a command), stands still because movement
// skips stunned entities, and recovers when the component is removed. A
// knight is handed a sword: a child in a `Descriptor.Hierarchy` that moves
// with its parent. An archer targets an enemy through a `Descriptor.Relation`;
// the enemy falls, and the archer stands down because it reads the dropped
// edge once.
import { Descriptor, Schema } from "@typeonce/ritmo"

/** The frames of one loop, and when each story's cue fires. */
export const LOOP = 700
export const HIT_AT = 30
export const STUN_FRAMES = 120
export const ARM_AT = 250
export const FALL_AT = 540

export const Name = Descriptor.Component<string>()("Arena/Name")
export const Position = Descriptor.Component<{ x: number; y: number }>()("Arena/Position")
export const Velocity = Descriptor.Component<{ x: number; y: number }>()("Arena/Velocity")
/** The span an entity walks back and forth in. */
export const Patrol = Descriptor.Component<{ min: number; max: number }>()("Arena/Patrol")
/** Where a held item sits, relative to its holder. */
export const Offset = Descriptor.Component<{ x: number; y: number }>()("Arena/Offset")
export const Stunned = Descriptor.Component<{ frames: number }>()("Arena/Stunned")
export const Guard = Descriptor.Tag("Arena/Guard")
export const Knight = Descriptor.Tag("Arena/Knight")
export const Enemy = Descriptor.Tag("Arena/Enemy")
export const Idle = Descriptor.Tag("Arena/Idle")

export const { relation: ChildOf } = Descriptor.Hierarchy("Arena/ChildOf", "Arena/Children")
export const { relation: Targeting } = Descriptor.Relation("Arena/Targeting", "Arena/TargetedBy")

export const Hit = Descriptor.Event<{}>()("Arena/Hit")
export const Arm = Descriptor.Event<{}>()("Arena/Arm")
export const Fall = Descriptor.Event<{}>()("Arena/Fall")

/** What the systems that react to a change heard, and on which tick. */
export interface Heard {
  readonly tick: number
  /** The tick the stun's removal was heard, and how many times it was. */
  readonly recovered: number | null
  readonly recoveredHeard: number
  /** The tick the archer heard its target's edge drop, and how many times it did. */
  readonly dropped: number | null
  readonly droppedHeard: number
}
export const Log = Descriptor.Resource<Heard>()("Arena/Log")

export const Game = Schema.bind(Schema.fragment({
  components: { Name, Position, Velocity, Patrol, Offset, Stunned, Guard, Knight, Enemy, Idle },
  relations: { ChildOf, Targeting },
  events: { Hit, Arm, Fall },
  resources: { Log }
}))

/** Lane centres on a 960-wide arena. */
export const LANES = [160, 480, 800] as const

const Spawn = Game.System(
  "Arena/Spawn",
  {
    commands: Game.System.commands(
      Game.System.spawns(Name, Position, Velocity, Patrol, Guard, Knight, Enemy),
      Game.System.relates(Targeting)
    )
  },
  ({ commands }) => {
    commands.spawn(Game.Command.spawn(
      [Name, "guard"], [Guard, {}], [Position, { x: LANES[0], y: 190 }],
      [Velocity, { x: 1.6, y: 0 }], [Patrol, { min: LANES[0] - 90, max: LANES[0] + 90 }]
    ))
    commands.spawn(Game.Command.spawn(
      [Name, "knight"], [Knight, {}], [Position, { x: LANES[1], y: 190 }],
      [Velocity, { x: 1.2, y: 0 }], [Patrol, { min: LANES[1] - 80, max: LANES[1] + 80 }]
    ))
    const enemy = commands.spawn(Game.Command.spawn(
      [Name, "enemy"], [Enemy, {}], [Position, { x: LANES[2], y: 110 }],
      [Velocity, { x: 1.4, y: 0 }], [Patrol, { min: LANES[2] - 90, max: LANES[2] + 90 }]
    ))
    commands.spawn(Game.Command.relate(
      Game.Command.spawn([Name, "archer"], [Position, { x: LANES[2], y: 220 }]),
      Targeting,
      enemy
    ))
  }
)

const Count = Game.System("Arena/Count", { resources: { log: Game.System.writeResource(Log) } }, ({ resources }) => {
  resources.log.set({ ...resources.log.get(), tick: resources.log.get().tick + 1 })
})

/** A hit stuns every guard that is not stunned already. */
const Stun = Game.System(
  "Arena/Stun",
  {
    queries: { guards: Game.Query({ selection: {}, with: [Guard], without: [Stunned] }) },
    events: { hits: Game.System.readEvent(Hit) },
    commands: Game.System.commands(Game.System.inserts(Stunned))
  },
  ({ queries, events, commands }) => {
    if (events.hits.all().length === 0) return
    for (const match of queries.guards.each()) commands.insert(match.entity, [Stunned, { frames: STUN_FRAMES }])
  }
)

/** The stun wears off: the component is removed when its frames run out. */
const WearOff = Game.System(
  "Arena/WearOff",
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

/** Walks every patrol back and forth; a stunned entity is not in the query. */
const Move = Game.System(
  "Arena/Move",
  {
    queries: {
      movers: Game.Query({
        selection: {
          position: Game.Query.write(Position),
          velocity: Game.Query.write(Velocity),
          patrol: Game.Query.read(Patrol)
        },
        without: [Stunned]
      })
    }
  },
  ({ queries }) => {
    for (const { data } of queries.movers.each()) {
      const { x, y } = data.position.get()
      const velocity = data.velocity.get()
      const patrol = data.patrol.get()
      const next = x + velocity.x
      if (next < patrol.min || next > patrol.max) data.velocity.set({ x: -velocity.x, y: velocity.y })
      data.position.set({ x: Math.min(patrol.max, Math.max(patrol.min, next)), y })
    }
  }
)

/** Hands every knight a sword, spawned already in its hand. */
const Equip = Game.System(
  "Arena/Equip",
  {
    queries: { knights: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Knight] }) },
    events: { arm: Game.System.readEvent(Arm) },
    commands: Game.System.commands(Game.System.spawns(Name, Position, Offset), Game.System.relates(ChildOf))
  },
  ({ queries, events, commands }) => {
    if (events.arm.all().length === 0) return
    for (const { entity, data } of queries.knights.each()) {
      const { x, y } = data.position.get()
      commands.spawn(Game.Command.relate(
        Game.Command.spawn([Name, "sword"], [Position, { x: x + 26, y: y - 4 }], [Offset, { x: 26, y: -4 }]),
        ChildOf,
        entity.id
      ))
    }
  }
)

/** A held item sits at its holder's position plus its offset. */
const Follow = Game.System(
  "Arena/Follow",
  {
    queries: {
      held: Game.Query({
        selection: {
          position: Game.Query.write(Position),
          offset: Game.Query.read(Offset),
          parent: Game.Query.readRelation(ChildOf)
        },
        withRelations: [ChildOf]
      }),
      holders: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Knight] })
    }
  },
  ({ queries }) => {
    for (const { data } of queries.held.each()) {
      const holder = queries.holders.get(data.parent.get())
      if (!holder.ok) continue
      const at = holder.value.data.position.get()
      const offset = data.offset.get()
      data.position.set({ x: at.x + offset.x, y: at.y + offset.y })
    }
  }
)

const Strike = Game.System(
  "Arena/Strike",
  {
    queries: { enemies: Game.Query({ selection: {}, with: [Enemy] }) },
    events: { fall: Game.System.readEvent(Fall) },
    commands: Game.System.commands(Game.System.despawns(Enemy))
  },
  ({ queries, events, commands }) => {
    if (events.fall.all().length === 0) return
    for (const match of queries.enemies.each()) commands.despawn(match.entity)
  }
)

/** Hears each recovery once, on its next run. */
const Feedback = Game.System(
  "Arena/Feedback",
  {
    removed: { recovered: Game.System.readRemoved(Stunned) },
    resources: { log: Game.System.writeResource(Log) }
  },
  ({ removed, resources }) => {
    if (removed.recovered.all().length === 0) return
    const log = resources.log.get()
    resources.log.set({ ...log, recovered: log.tick, recoveredHeard: log.recoveredHeard + 1 })
  }
)

/** An archer whose target is gone stands down, the one time it hears so. */
const StandDown = Game.System(
  "Arena/StandDown",
  {
    droppedRelations: { lost: Game.System.readDroppedRelations(Targeting) },
    resources: { log: Game.System.writeResource(Log) },
    commands: Game.System.commands(Game.System.inserts(Idle))
  },
  ({ droppedRelations, resources, commands }) => {
    for (const { source } of droppedRelations.lost.all()) {
      commands.insert(source, [Idle, {}])
      const log = resources.log.get()
      resources.log.set({ ...log, dropped: log.tick, droppedHeard: log.droppedHeard + 1 })
    }
  }
)

export const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
export const update = Game.Schedule(
  Count, Stun, Equip, Strike, WearOff, Move, Follow,
  Game.Schedule.applyDeferred(),
  Feedback, StandDown,
  Game.Schedule.applyDeferred()
)

export interface Seen {
  readonly id: number
  readonly name: string
  readonly x: number
  readonly y: number
  /** The components it holds right now, as the page prints them. */
  readonly components: ReadonlyArray<string>
}

const Everyone = Game.Query({
  selection: {
    name: Game.Query.read(Name),
    position: Game.Query.read(Position),
    velocity: Game.Query.optional(Velocity),
    stunned: Game.Query.optional(Stunned),
    offset: Game.Query.optional(Offset),
    guard: Game.Query.optional(Guard),
    knight: Game.Query.optional(Knight),
    enemy: Game.Query.optional(Enemy),
    idle: Game.Query.optional(Idle),
    parent: Game.Query.optionalRelation(ChildOf),
    target: Game.Query.optionalRelation(Targeting),
    children: Game.Query.optionalRelated(ChildOf)
  }
})

export const ReadArena = Game.Inspector(
  "Arena/Read",
  { queries: { everyone: Everyone }, resources: { log: Game.System.readResource(Log) } },
  ({ queries, resources }) => ({
    log: resources.log.get(),
    entities: queries.everyone.each().map(({ entity, data }): Seen => {
      const components: Array<string> = []
      if (data.guard.present) components.push("Guard")
      if (data.knight.present) components.push("Knight")
      if (data.enemy.present) components.push("Enemy")
      components.push("Position")
      if (data.velocity.present) components.push("Velocity")
      if (data.offset.present) components.push("Offset")
      if (data.stunned.present) components.push(`Stunned { frames: ${data.stunned.get().frames} }`)
      if (data.parent.present) components.push(`ChildOf → #${data.parent.get()}`)
      if (data.children.present) components.push(`Children [${data.children.get().map((id) => `#${id}`).join(", ")}]`)
      if (data.target.present) components.push(`Targeting → #${data.target.get()}`)
      if (data.idle.present) components.push("Idle")
      const { x, y } = data.position.get()
      return { id: Number(entity.id), name: data.name.get(), x, y, components }
    })
  })
)

export const makeArena = () => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: { Log: { tick: 0, recovered: null, recoveredHeard: 0, dropped: null, droppedHeard: 0 } }
  })
  if (!made.ok) throw new Error("The composition demo could not build the world.")
  const runtime = made.value
  runtime.tick(setup)
  let frame = 0
  return {
    step: () => {
      if (frame === HIT_AT) runtime.send(Hit, {})
      if (frame === ARM_AT) runtime.send(Arm, {})
      if (frame === FALL_AT) runtime.send(Fall, {})
      const ticked = runtime.tick(update)
      if (!ticked.ok) throw new Error(`The composition demo failed on frame ${frame}.`)
      frame++
    },
    frame: () => frame,
    read: () => runtime.inspect(ReadArena)
  }
}
