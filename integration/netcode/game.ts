/**
 * A small two-player shooter, deterministic so peers can run it apart and
 * agree: players move and fire from per-tick input, shots fly, hit, and
 * score, and a round ends at three hits and starts again. It stores an
 * entity handle in a component (a shot's owner) and a deadline (a
 * player's next shot), arms new shots through an
 * `added` filter (so it depends on every reader's position), draws from a
 * random state kept in a resource, keeps shots in a scope the round wipes,
 * and has a state machine with per-state data.
 *
 * Input comes from one source service per runtime: each seat's input for
 * the tick being run, filled by a `Netcode` session (confirmed input, or a
 * guess) or, for the reference runtime, by the test.
 */
import { Clock, Descriptor, Entity, Random, Schema } from "@typeonce/ritmo"
import { InputCapture } from "@typeonce/ritmo-browser"
import { Netcode } from "@typeonce/ritmo-netcode"

import { guard, integer, nullable, struct, tuple } from "./codecs.ts"

export const Root = Schema.defineRoot("Netcode")
export const step = Clock.hz(60)

/** One player's input for one tick. */
export interface PlayerInput {
  readonly dx: -1 | 0 | 1
  readonly dy: -1 | 0 | 1
  readonly fire: boolean
}

const isStep = (raw: unknown): raw is -1 | 0 | 1 => raw === -1 || raw === 0 || raw === 1

/** How a remote seat's input is checked when it arrives. */
export const playerInput = guard("a player input", (raw: unknown): raw is PlayerInput => {
  if (typeof raw !== "object" || raw === null) return false
  const { dx, dy, fire } = raw as Record<string, unknown>
  return isStep(dx) && isStep(dy) && typeof fire === "boolean"
})

export const idle: PlayerInput = { dx: 0, dy: 0, fire: false }

export const arena = { width: 200, height: 100 } as const

const point = struct({ x: integer, y: integer })
export const Position = Descriptor.ConstructedComponent(point)("Netcode/Position")
/** A player's seat, and the step it may fire again on (`null` until its first shot). */
export const Player = Descriptor.ConstructedComponent(struct({
  seat: integer,
  ready: nullable(guard("a deadline", Clock.isDeadline(step)))
}))("Netcode/Player")
/** Steps between two shots of one player. */
const reload = Clock.durationOfSteps(step, 9)
export const Shot = Descriptor.ConstructedComponent(struct({
  owner: guard("a player handle", Entity.isHandle(Root, Player)),
  dx: integer,
  life: integer
}))("Netcode/Shot")

export const Time = Clock.resource("Netcode/Time", step)
export const Rng = Descriptor.ConstructedResource(Random.codec)("Netcode/Rng")
export const Score = Descriptor.ConstructedResource(tuple(integer, integer))("Netcode/Score")
export const InputSource = Descriptor.Service<Netcode.Source<PlayerInput>>()("Netcode/InputSource")
export const Inputs = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof InputSource>>()("Netcode/Inputs")
export const Hit = Descriptor.Event<{ readonly seat: number; readonly shot: number }>()("Netcode/Hit")

export const Game = Schema.bind(Schema.fragment({
  components: { Position, Player, Shot },
  resources: { Time, Rng, Score, Inputs },
  events: { Hit }
}), Root)

export const Round = Game.StateMachine("Netcode/Round", {
  Playing: {},
  Over: struct({ winner: integer, left: integer })
})
/** Shots belong to the rally: a round that ends wipes them. */
export const Rally = Game.EntityScope("Netcode/Rally", { despawnOnExit: [Round, "Playing"] })

const playing = Game.Condition.inState(Round, "Playing")

const Capture = InputCapture.system(Game, { name: "Netcode/Capture", source: InputSource, resource: Inputs })
const Ticking = Clock.system(Game, { name: "Netcode/Clock", resource: Time })

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

const Move = Game.System("Netcode/Move", {
  when: [playing],
  resources: { inputs: Game.System.readResource(Inputs) },
  queries: { players: Game.Query({ selection: { position: Game.Query.write(Position), player: Game.Query.read(Player) } }) }
}, ({ resources, queries }) => {
  const inputs = resources.inputs.get()
  for (const { data } of queries.players.each()) {
    const input = inputs[data.player.get().seat]!
    data.position.update((at) => ({ x: clamp(at.x + input.dx * 2, 0, arena.width), y: clamp(at.y + input.dy * 2, 0, arena.height) }))
  }
})

const Fire = Game.System("Netcode/Fire", {
  when: [playing],
  resources: {
    time: Game.System.thisTick(Game.System.readResource(Time)),
    inputs: Game.System.readResource(Inputs),
    rng: Game.System.writeResource(Rng)
  },
  queries: { players: Game.Query({ selection: { position: Game.Query.read(Position), player: Game.Query.write(Player) } }) },
  commands: Game.System.commands(Game.System.spawns(Position, Shot))
}, ({ resources, queries, commands }) => {
  const time = resources.time.get()
  const inputs = resources.inputs.get()
  const random = Random.draw(resources.rng)
  for (const { entity, data } of queries.players.each()) {
    const player = data.player.get()
    if (player.ready !== null && !Clock.reached(time, player.ready)) continue
    if (!inputs[player.seat]!.fire) continue
    const at = data.position.get()
    // Shots leave a little above or below the muzzle: the spread is the game's randomness.
    const spread = random.integer(-2, 3)
    commands.spawnIn(Rally, Game.Command.spawn(
      [Position, { x: at.x, y: clamp(at.y + spread, 0, arena.height) }],
      [Shot, { owner: Game.Entity.handle(entity.id, Player), dx: player.seat === 0 ? 4 : -4, life: 0 }]
    ))
    data.player.set({ ...player, ready: Clock.deadline(time, reload) })
  }
})

/** New shots get their range here, the tick after they appear: through `added`, so it relies on read positions. */
const Arm = Game.System("Netcode/Arm", {
  queries: { fresh: Game.Query({ selection: { shot: Game.Query.write(Shot) }, filters: [Game.Query.added(Shot)] }) }
}, ({ queries }) => {
  for (const { data } of queries.fresh.each()) data.shot.update((shot) => ({ ...shot, life: 50 }))
})

const Fly = Game.System("Netcode/Fly", {
  queries: {
    shots: Game.Query({ selection: { position: Game.Query.write(Position), shot: Game.Query.write(Shot) } }),
    players: Game.Query({ selection: { position: Game.Query.read(Position), player: Game.Query.read(Player) } })
  },
  resources: { score: Game.System.writeResource(Score) },
  events: { hit: Game.System.writeEvent(Hit) },
  commands: Game.System.commands(Game.System.despawns(Shot))
}, ({ queries, resources, events, commands }) => {
  for (const { entity, data } of queries.shots.each()) {
    const shot = data.shot.get()
    const at = data.position.get()
    const next = { x: at.x + shot.dx, y: at.y }
    if (shot.life <= 1 || next.x < 0 || next.x > arena.width) {
      commands.despawn(entity)
      continue
    }
    data.position.set(next)
    data.shot.set({ ...shot, life: shot.life - 1 })
    const owner = queries.players.getHandle(shot.owner)
    const seat = owner.ok ? owner.value.data.player.get().seat : -1
    for (const target of queries.players.each()) {
      const other = target.data.player.get().seat
      const where = target.data.position.get()
      if (other === seat || Math.abs(where.x - next.x) > 3 || Math.abs(where.y - next.y) > 3) continue
      resources.score.update(([left, right]) => seat === 0 ? [left + 1, right] : [left, right + 1])
      events.hit.emit({ seat, shot: entity.id })
      commands.despawn(entity)
      break
    }
  }
})

const Decide = Game.System("Netcode/Decide", {
  resources: { score: Game.System.readResource(Score) },
  machines: { round: Game.System.updateMachine(Round) },
  nextMachines: { round: Game.System.nextState(Round) }
}, ({ resources, machines, nextMachines }) => {
  const round = machines.round.get()
  if (round._tag === "Playing") {
    const [left, right] = resources.score.get()
    if (left >= 3 || right >= 3) nextMachines.round.set({ _tag: "Over", winner: left >= 3 ? 0 : 1, left: 20 })
    return
  }
  if (round.left <= 1) nextMachines.round.set({ _tag: "Playing" })
  else machines.round.update({ state: "Over", data: (over) => ({ ...over, left: over.left - 1 }) })
})

const ResetScore = Game.System("Netcode/ResetScore", {
  resources: { score: Game.System.writeResource(Score) }
}, ({ resources }) => {
  resources.score.set([0, 0])
})

const rounds = Game.Schedule.transitions(Game.Schedule.onEnter(Round, "Playing", [ResetScore]))

/** One tick of the game. Every peer runs exactly this, with the input it has for the tick. */
export const simulate = Game.Schedule(
  Capture,
  Ticking,
  Move,
  Fire,
  Game.Schedule.applyDeferred(),
  Arm,
  Fly,
  Decide,
  Game.Schedule.applyStateTransitions(rounds)
)

const Join = Game.System("Netcode/Join", {
  commands: Game.System.commands(Game.System.spawns(Position, Player))
}, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Position, { x: 10, y: 50 }], [Player, { seat: 0, ready: null }]))
  commands.spawn(Game.Command.spawn([Position, { x: 190, y: 50 }], [Player, { seat: 1, ready: null }]))
})

/** Spawns both players: run once, the same way, on every peer. */
export const setup = Game.Schedule(Join, Game.Schedule.applyDeferred())

/** What one draw did: the sprites it made and took down, by entity. */
export interface Drawn {
  readonly created: Array<number>
  readonly destroyed: Array<number>
}

/**
 * Where the host draws: a sprite per shot, and what every draw did. It
 * stands in for a renderer (`RenderSync` keeps its nodes the same way), so a
 * test can see what a rollback looks like on screen.
 */
export interface Screen {
  readonly sprites: Map<number, { x: number; y: number }>
  readonly draws: Array<Drawn>
}

export const ScreenService = Descriptor.Service<Screen>()("Netcode/Screen")

const Draw = Game.System("Netcode/Draw", {
  services: { screen: Game.System.service(ScreenService) },
  removed: { shots: Game.System.readRemoved(Shot), positions: Game.System.readRemoved(Position) },
  queries: {
    sync: Game.Query({
      selection: { position: Game.Query.read(Position), shot: Game.Query.read(Shot) },
      filters: [Game.Query.anyOf(Game.Query.added(Shot), Game.Query.changed(Position))]
    })
  }
}, ({ services, removed, queries }) => {
  const { sprites, draws } = services.screen
  const drawn: Drawn = { created: [], destroyed: [] }
  draws.push(drawn)
  // Take down first, like a renderer: an entity that lost a shot since the last draw has no sprite.
  for (const entity of [...removed.shots.all(), ...removed.positions.all()]) {
    if (sprites.delete(entity)) drawn.destroyed.push(entity)
  }
  for (const { entity, data } of queries.sync.each()) {
    if (!sprites.has(entity.id)) drawn.created.push(entity.id)
    sprites.set(entity.id, { ...data.position.get() })
  }
})

/**
 * Draws the shots. It runs after the ticks of a frame, outside `simulate`,
 * so it never rewinds: a rollback reaches it as ordinary changes.
 */
export const draw = Game.Schedule(Draw)

/**
 * A runtime of the game, with the screen it draws on, reading input from
 * `source`: a session's `seats.source`, or one the test fills.
 */
export const makeRuntime = (source: Netcode.Source<PlayerInput>) => {
  const screen: Screen = { sprites: new Map(), draws: [] }
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(InputSource, source), Game.Runtime.service(ScreenService, screen)),
    resources: { Time: Clock.start(step), Rng: Random.seed(7), Score: [0, 0], Inputs: [idle, idle] },
    machines: Game.Runtime.machines(Game.Runtime.machine(Round, { _tag: "Playing" }))
  })
  // The values above are valid by construction; the Result covers validated resources in general.
  if (!made.ok) throw new Error("the starting resources did not validate")
  return { runtime: made.value, screen }
}

export type GameRuntime = ReturnType<typeof makeRuntime>["runtime"]
