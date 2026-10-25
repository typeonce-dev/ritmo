/**
 * A small deterministic game for session tests: each seat moves a player
 * by its input, firing spawns a marker that lives a few ticks, and a total
 * in a resource sums every move, so a wrong input on any tick changes the
 * checksum from then on.
 */
import { Clock, Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { InputCapture } from "@typeonce/ritmo-browser"
import { Netcode } from "@typeonce/ritmo-netcode"

type Check<T> = (raw: unknown) => { readonly value: T } | { readonly issues: ReadonlyArray<{ readonly message: string }> }
const schema = <T>(check: Check<T>): Descriptor.StandardSchema<T, T> => ({ "~standard": { version: 1, vendor: "test", validate: check } })
const fail = (message: string) => ({ issues: [{ message }] })
const integer = (raw: unknown) => Number.isSafeInteger(raw)

export interface PlayerInput {
  readonly dx: number
  readonly fire: boolean
}

export const PlayerInput = schema<PlayerInput>((raw) => {
  if (typeof raw !== "object" || raw === null) return fail("Expected an input")
  const { dx, fire } = raw as Record<string, unknown>
  return integer(dx) && typeof fire === "boolean" ? { value: { dx: dx as number, fire } } : fail("Expected { dx, fire }")
})

export const idle: PlayerInput = { dx: 0, fire: false }

const Whole = schema<number>((raw) => integer(raw) ? { value: raw as number } : fail("Expected an integer"))
const Pair = schema<{ readonly seat: number; readonly x: number }>((raw) => {
  const { seat, x } = (raw ?? {}) as Record<string, unknown>
  return integer(seat) && integer(x) ? { value: { seat: seat as number, x: x as number } } : fail("Expected { seat, x }")
})

export const step = Clock.hz(60)
export const Player = Descriptor.ConstructedComponent(Pair)("NetTest/Player")
export const Marker = Descriptor.ConstructedComponent(Whole)("NetTest/Marker")
export const Total = Descriptor.ConstructedResource(Whole)("NetTest/Total")
export const Time = Clock.resource("NetTest/Time", step)
export const Seats = Descriptor.Service<Netcode.Source<PlayerInput>>()("NetTest/Seats")
export const Inputs = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof Seats>>()("NetTest/Inputs")
/** A seat fired, where its player stood: what host code reads through `session.events`. */
export const Fired = Descriptor.Event<{ readonly seat: number; readonly x: number }>()("NetTest/Fired")
/** Host-side and out of band: lets a test break one peer's determinism on purpose. */
export const Drift = Descriptor.ConstructedResource(Whole)("NetTest/Drift")

export const Game = Schema.bind(Schema.fragment({ components: { Player, Marker }, resources: { Total, Time, Inputs, Drift }, events: { Fired } }))

const Capture = InputCapture.system(Game, { name: "NetTest/Capture", source: Seats, resource: Inputs })
const Ticking = Clock.system(Game, { name: "NetTest/Clock", resource: Time })

const Move = Game.System("NetTest/Move", {
  resources: { inputs: Game.System.readResource(Inputs), total: Game.System.writeResource(Total), drift: Game.System.readResource(Drift) },
  queries: { players: Game.Query({ selection: { player: Game.Query.write(Player) } }) },
  events: { fired: Game.System.writeEvent(Fired) },
  commands: Game.System.commands(Game.System.spawns(Marker))
}, ({ resources, queries, events, commands }) => {
  const inputs = resources.inputs.get()
  for (const { data } of queries.players.each()) {
    const player = data.player.get()
    const input = inputs[player.seat]!
    data.player.set({ ...player, x: player.x + input.dx })
    resources.total.update((total) => (total * 3 + input.dx + resources.drift.get()) % 1_000_003)
    if (input.fire) {
      commands.spawn(Game.Command.spawn([Marker, 4]))
      events.fired.emit({ seat: player.seat, x: player.x + input.dx })
    }
  }
})

const Fade = Game.System("NetTest/Fade", {
  queries: { markers: Game.Query({ selection: { marker: Game.Query.write(Marker) } }) },
  commands: Game.System.commands(Game.System.despawns(Marker))
}, ({ queries, commands }) => {
  for (const { entity, data } of queries.markers.each()) {
    const left = data.marker.get() - 1
    if (left <= 0) commands.despawn(entity)
    else data.marker.set(left)
  }
})

export const simulate = Game.Schedule(Capture, Ticking, Fade, Move, Game.Schedule.applyDeferred())

const join = (count: number) => Game.System(`NetTest/Join${count}`, {
  commands: Game.System.commands(Game.System.spawns(Player))
}, ({ commands }) => {
  for (let seat = 0; seat < count; seat++) commands.spawn(Game.Command.spawn([Player, { seat, x: seat * 100 }]))
})
const setups = new Map([2, 3].map((count) => [count, Game.Schedule(join(count), Game.Schedule.applyDeferred())] as const))

const Bump = Game.System("NetTest/Bump", { resources: { drift: Game.System.writeResource(Drift) } }, ({ resources }) => {
  resources.drift.update((drift) => drift + 1)
})
/** Run on one peer only, outside the session: its world no longer matches the others'. */
export const drift = Game.Schedule(Bump)

/** A runtime of the game and its seats, set up. Peers other than seat 0 need no setup: they restore seat 0's save. */
export const makePeer = (options: { readonly count?: number; readonly checkpoints?: number; readonly setUp?: boolean; readonly drift?: number } = {}) => {
  const seats = Netcode.seats(PlayerInput, { count: options.count ?? 2, idle })
  if (!seats.ok) throw new Error(seats.error.reason)
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Seats, seats.value.source)),
    resources: { Total: 0, Time: Clock.start(step), Inputs: [idle, idle], Drift: options.drift ?? 0 },
    ...(options.checkpoints === undefined ? {} : { checkpoints: options.checkpoints })
  })
  if (!made.ok) throw new Error("the starting resources did not validate")
  const runtime = made.value
  if (options.setUp !== false) {
    const ran = runtime.tick(setups.get(options.count ?? 2)!)
    if (!ran.ok) throw new Error("setup failed")
  }
  return { runtime, seats: seats.value }
}

export type Peer = ReturnType<typeof makePeer>

/** The input a seat presses on frame `frame` of a test: seeded by seat, so seats differ. */
export const pressed = (seat: number, frame: number): PlayerInput => {
  const value = (frame * 7 + seat * 13 + (frame >> 3) * 5) % 11
  return { dx: (value % 3) - 1, fire: value === 4 }
}

export { HostClock }
