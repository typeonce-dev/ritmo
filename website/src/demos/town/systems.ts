// The town's rules. Each system declares exactly what it reads and writes;
// the schedule (schedules.ts) decides when each runs.
import { Clock } from "@typeonce/ritmo"
import * as Random from "@typeonce/ritmo/Random"

import { cellInFront, cellPosition, directions, isOpenGround, opposite, playerStart, sameCell, signs, TILE_SIZE, villagers } from "./map.ts"
import type { Cell, Direction } from "./map.ts"
import {
  BUMP,
  Facing,
  Game,
  Host,
  Input,
  Look,
  LOOK_AROUND,
  Mode,
  PACE_REST,
  Patrol,
  Player,
  Players,
  PlayersInput,
  Position,
  Rng,
  Seat,
  Signpost,
  Solid,
  Stride,
  Talkable,
  Tile,
  Time,
  TURN,
  TYPE,
  Villager,
  WALK
} from "./schema.ts"
import type { Foot, SeatValue, StrideValue } from "./schema.ts"

// ── Setup ───────────────────────────────────────────────────────────────

const standing: StrideValue = { kind: "still", foot: "left", rested: true }

/** Puts the villagers and the signs on the map. Players appear when they join. */
export const SpawnTown = Game.System(
  "Town/SpawnTown",
  { commands: Game.System.commands(Game.System.spawns(Villager, Patrol, Signpost)) },
  ({ commands }) => {
    for (const villager of villagers) {
      const draft = Game.Command.spawn(
        Game.Command.entry(Villager, {}),
        Game.Command.entry(Tile, villager.cell),
        Game.Command.entry(Position, cellPosition(villager.cell)),
        Game.Command.entry(Facing, villager.facing),
        Game.Command.entry(Look, { character: villager.character }),
        Game.Command.entry(Talkable, { speaker: villager.speaker, pages: villager.pages }),
        Game.Command.entry(Solid, {})
      )
      if ("route" in villager) {
        commands.spawn(Game.Command.extend(
          draft,
          Game.Command.entry(Patrol, { ends: villager.route, heading: 1, rest: 0 }),
          Game.Command.entry(Stride, standing)
        ))
      } else {
        commands.spawn(draft)
      }
    }
    for (const sign of signs) {
      commands.spawn(Game.Command.spawn(
        Game.Command.entry(Signpost, {}),
        Game.Command.entry(Tile, sign.cell),
        Game.Command.entry(Position, cellPosition(sign.cell)),
        Game.Command.entry(Talkable, { speaker: "Sign", pages: sign.pages }),
        Game.Command.entry(Solid, {})
      ))
    }
  }
)

/**
 * The first player is in from the start, on the host's device; a second
 * drops in and out the whole time, so joining opens once, here.
 */
export const SeatFirstPlayer = Game.System(
  "Town/SeatFirstPlayer",
  {
    services: { players: Game.System.service(PlayersInput) },
    resources: { host: Game.System.readResource(Host) }
  },
  ({ services, resources }) => {
    // At setup every slot and device is free, so seating p1 cannot fail.
    services.players.seat("p1", resources.host.get())
    services.players.setJoining(true)
  }
)

// ── Players joining and leaving ─────────────────────────────────────────

/**
 * Joining (and leaving by button) is open only while exploring: a player
 * cannot walk out of a conversation and leave its box behind, and nobody
 * drops in halfway through one. Runs after the mode changes, so the next
 * update's input sees it.
 */
export const JoinWhileExploring = Game.System(
  "Town/JoinWhileExploring",
  {
    services: { players: Game.System.service(PlayersInput) },
    machines: { mode: Game.System.machine(Mode) }
  },
  ({ services, machines }) => services.players.setJoining(machines.mode.is("Exploring"))
)

/** The second player is the same boy, tinted, so the two are told apart. */
const tints: Readonly<Record<SeatValue, number | undefined>> = { p1: undefined, p2: 0x9fd8ff }

/**
 * A player who joins appears at the house door, or beside the other player
 * when someone stands there; one who leaves disappears.
 */
export const JoinPlayers = Game.System(
  "Town/JoinPlayers",
  {
    queries: {
      players: Game.Query({ selection: { seat: Game.Query.read(Seat), tile: Game.Query.read(Tile), facing: Game.Query.read(Facing) }, with: [Player] }),
      solids: Game.Query({ selection: { tile: Game.Query.read(Tile), stride: Game.Query.optional(Stride) }, with: [Solid] })
    },
    resources: { input: Game.System.readResource(Input) },
    commands: Game.System.commands(Game.System.spawns(Player), Game.System.despawns(Player))
  },
  ({ queries, resources, commands }) => {
    const input = resources.input.get()
    for (const seat of Players.slots) {
      if (input[seat].event === "left") {
        for (const { entity, data } of queries.players.each()) if (data.seat.get() === seat) commands.despawn(entity)
      }
      if (input[seat].event !== "joined") continue
      const free = (cell: Cell) => isOpenGround(cell) &&
        !queries.solids.each().some(({ data }) => occupies({ tile: data.tile.get(), stride: data.stride.value() }, cell))
      const other = queries.players.each().find(({ data }) => data.seat.get() !== seat)
      const near = other === undefined ? playerStart.cell : other.data.tile.get()
      const cell = [near, ...directions.map((direction) => cellInFront(near, direction))].find(free)
      if (cell === undefined) continue
      const tint = tints[seat]
      commands.spawn(Game.Command.spawn(
        Game.Command.entry(Player, {}),
        Game.Command.entry(Seat, seat),
        Game.Command.entry(Tile, cell),
        Game.Command.entry(Position, cellPosition(cell)),
        Game.Command.entry(Facing, other?.data.facing.get() ?? playerStart.facing),
        Game.Command.entry(Look, tint === undefined ? { character: playerStart.character } : { character: playerStart.character, tint }),
        Game.Command.entry(Stride, standing),
        Game.Command.entry(Solid, {})
      ))
    }
  }
)

// ── Walking ─────────────────────────────────────────────────────────────

/** One read-write slot of an actor's data: a query write cell. */
interface Slot<T> {
  get(): T
  set(value: T): void
}

/** The data every walking actor has: the player and the pacing villagers. */
interface Mover {
  readonly tile: Slot<Cell>
  readonly position: Slot<{ readonly x: number; readonly y: number }>
  readonly facing: Slot<Direction>
  readonly stride: Slot<StrideValue>
}

/** Whether a solid actor stands on `cell`, or is still leaving it mid-step. */
const occupies = (blocker: { readonly tile: Cell; readonly stride: StrideValue | undefined }, cell: Cell): boolean =>
  sameCell(blocker.tile, cell) || (blocker.stride?.kind === "walk" && sameCell(blocker.stride.from, cell))

type DirectionActions = { readonly [K in "up" | "down" | "left" | "right"]: { readonly held: boolean; readonly pressed: boolean } }

/**
 * The most two players may stand apart, in tiles: the camera frames both,
 * so neither walks off the shared screen (15 x 10 tiles).
 */
const LEASH = { cols: 13, rows: 8 } as const

/**
 * The direction the player holds (or tapped within this step): the one they
 * face if held, so walking straight never flickers, else the first held.
 */
const heldDirection = (input: { readonly actions: DirectionActions }, facing: Direction): Direction | undefined => {
  const down = (action: { readonly held: boolean; readonly pressed: boolean }) => action.held || action.pressed
  const held = {
    Down: down(input.actions.down),
    Up: down(input.actions.up),
    Left: down(input.actions.left),
    Right: down(input.actions.right)
  } satisfies Record<Direction, boolean>
  return held[facing] ? facing : directions.find((direction) => held[direction])
}

const otherFoot = (foot: Foot): Foot => foot === "left" ? "right" : "left"

/** The pixel position `elapsed` steps into a walk from `from` to `to`: whole pixels, exact on both tiles. */
const walkPosition = (from: Cell, to: Cell, elapsed: number) => {
  const moved = Math.round((TILE_SIZE * elapsed) / Clock.steps(WALK))
  const start = cellPosition(from)
  return { x: start.x + (to.col - from.col) * moved, y: start.y + (to.row - from.row) * moved }
}

/**
 * Moves a walk, turn, or bump on by one step of the clock. Returns true
 * while one is under way (a begun step always finishes), false once the
 * actor stands on its tile and may decide what to do next.
 */
const advanceStride = (mover: Mover): boolean => {
  const stride = mover.stride.get()
  if (stride.kind === "still") return false
  const elapsed = stride.elapsed + 1
  if (stride.kind === "walk") {
    mover.position.set(walkPosition(stride.from, mover.tile.get(), elapsed))
    mover.stride.set(elapsed >= Clock.steps(WALK) ? { kind: "still", foot: otherFoot(stride.foot), rested: false } : { ...stride, elapsed })
    return true
  }
  const length = Clock.steps(stride.kind === "turn" ? TURN : BUMP)
  mover.stride.set(elapsed >= length
    ? { kind: "still", foot: stride.kind === "bump" ? otherFoot(stride.foot) : stride.foot, rested: true }
    : { ...stride, elapsed })
  return true
}

/** Starts a step onto the tile in front, taking that tile at once so nothing else can claim it meanwhile. */
const startWalk = (mover: Mover, foot: Foot) => {
  const tile = mover.tile.get()
  const target = cellInFront(tile, mover.facing.get())
  mover.tile.set(target)
  mover.position.set(walkPosition(tile, target, 1))
  mover.stride.set({ kind: "walk", foot, elapsed: 1, from: tile })
}

/**
 * Moves each player tile by tile, one clock step at a time, from that
 * player's own input. On a tile, the held direction turns the player (from
 * rest, a tap only turns), steps onto the next tile when it is free, or
 * bumps in place when something solid is there (the other player too) or
 * when the step would take the two players off one screen.
 */
export const WalkPlayer = Game.System(
  "Town/WalkPlayer",
  {
    queries: {
      players: Game.Query({
        selection: {
          seat: Game.Query.read(Seat),
          tile: Game.Query.write(Tile),
          position: Game.Query.write(Position),
          facing: Game.Query.write(Facing),
          stride: Game.Query.write(Stride)
        },
        with: [Player]
      }),
      blockers: Game.Query({ selection: { tile: Game.Query.read(Tile), stride: Game.Query.optional(Stride) }, with: [Solid], without: [Player] })
    },
    resources: {
      time: Game.System.readResource(Time),
      input: Game.System.readResource(Input)
    }
  },
  ({ queries, resources }) => {
    if (resources.time.get().dt === 0) return
    const input = resources.input.get()
    const players = queries.players.each()
    for (const player of players) {
      const mover: Mover = player.data
      if (advanceStride(mover)) continue

      const stride = mover.stride.get()
      if (stride.kind !== "still") continue
      const direction = heldDirection(input[player.data.seat.get()], mover.facing.get())
      if (direction === undefined) {
        if (!stride.rested) mover.stride.set({ ...stride, rested: true })
        continue
      }
      if (direction !== mover.facing.get()) {
        mover.facing.set(direction)
        if (stride.rested) {
          mover.stride.set({ kind: "turn", foot: stride.foot, elapsed: 1 })
          continue
        }
      }

      const target = cellInFront(mover.tile.get(), direction)
      const others = players.filter((other) => other.entity.id !== player.entity.id)
      const taken = queries.blockers.each().some(({ data }) => occupies({ tile: data.tile.get(), stride: data.stride.value() }, target)) ||
        others.some(({ data }) => occupies({ tile: data.tile.get(), stride: data.stride.get() }, target))
      const leashed = others.some(({ data }) =>
        Math.abs(data.tile.get().col - target.col) > LEASH.cols || Math.abs(data.tile.get().row - target.row) > LEASH.rows)
      if (!isOpenGround(target) || taken || leashed) {
        mover.stride.set({ kind: "bump", foot: stride.foot, elapsed: 1 })
        continue
      }
      startWalk(mover, stride.foot)
    }
  }
)

const towards = (from: Cell, to: Cell): Direction =>
  to.col > from.col ? "Right" : to.col < from.col ? "Left" : to.row > from.row ? "Down" : "Up"

/**
 * Walks each pacing villager to the end of its route and back, with a rest
 * of `PACE_REST` to twice that at each end (drawn from `Rng`, so a run
 * replays exactly). When the next tile is taken (the player, a sign,
 * anyone), the villager waits a moment and tries again: it never steps
 * into a solid tile or another actor.
 */
export const PaceVillagers = Game.System(
  "Town/PaceVillagers",
  {
    queries: {
      walkers: Game.Query({
        selection: {
          tile: Game.Query.write(Tile),
          position: Game.Query.write(Position),
          facing: Game.Query.write(Facing),
          stride: Game.Query.write(Stride),
          patrol: Game.Query.write(Patrol)
        }
      }),
      blockers: Game.Query({ selection: { tile: Game.Query.read(Tile), stride: Game.Query.optional(Stride) }, with: [Solid], without: [Patrol] })
    },
    resources: {
      time: Game.System.readResource(Time),
      rng: Game.System.writeResource(Rng)
    }
  },
  ({ queries, resources }) => {
    if (resources.time.get().dt === 0) return
    const random = Random.draw(resources.rng)
    const rest = Clock.steps(PACE_REST)
    for (const { data } of queries.walkers.each()) {
      const mover: Mover = data
      if (advanceStride(mover)) continue
      const patrol = data.patrol.get()
      if (patrol.rest > 0) {
        data.patrol.set({ ...patrol, rest: patrol.rest - 1 })
        continue
      }
      const tile = mover.tile.get()
      const end = patrol.ends[patrol.heading]
      if (sameCell(tile, end)) {
        data.patrol.set({ ends: patrol.ends, heading: patrol.heading === 0 ? 1 : 0, rest: random.integer(rest, rest * 2 + 1) })
        continue
      }
      mover.facing.set(towards(tile, end))
      const target = cellInFront(tile, mover.facing.get())
      const taken = queries.blockers.each().some((blocker) => occupies({ tile: blocker.data.tile.get(), stride: blocker.data.stride.value() }, target))
      if (!isOpenGround(target) || taken) {
        data.patrol.set({ ...patrol, rest: random.integer(rest / 2, rest) })
        continue
      }
      const stride = mover.stride.get()
      startWalk(mover, stride.kind === "still" ? stride.foot : "left")
    }
  }
)

/** Every `LOOK_AROUND`, each villager standing in place may face a new direction (a coin flip, then a random direction). */
export const LookAround = Game.System(
  "Town/LookAround",
  {
    queries: {
      villagers: Game.Query({ selection: { facing: Game.Query.write(Facing) }, with: [Villager], without: [Patrol] })
    },
    resources: {
      time: Game.System.readResource(Time),
      rng: Game.System.writeResource(Rng)
    }
  },
  ({ queries, resources }) => {
    if (!Clock.every(resources.time.get(), LOOK_AROUND)) return
    const random = Random.draw(resources.rng)
    for (const { data } of queries.villagers.each()) {
      if (random.next() < 0.5) continue
      const next = random.pick(directions)
      if (next !== undefined) data.facing.set(next)
    }
  }
)

// ── Talking ─────────────────────────────────────────────────────────────

/** The player number shown in talks: p1 is player 1. */
const playerNumber = (seat: SeatValue): number => Players.slots.indexOf(seat) + 1

/**
 * The action button, standing still and facing something talkable (or the
 * other player), opens its pages and switches the mode to `Talking` (at the
 * next `applyStateTransitions()`). A villager or player spoken to turns to
 * face the speaker.
 */
export const StartTalk = Game.System(
  "Town/StartTalk",
  {
    queries: {
      players: Game.Query({
        selection: { seat: Game.Query.read(Seat), tile: Game.Query.read(Tile), facing: Game.Query.write(Facing), stride: Game.Query.read(Stride) },
        with: [Player]
      }),
      talkables: Game.Query({ selection: { tile: Game.Query.read(Tile), talkable: Game.Query.read(Talkable), stride: Game.Query.optional(Stride) } }),
      listeners: Game.Query({ selection: { facing: Game.Query.write(Facing) }, with: [Villager], without: [Player] })
    },
    resources: { input: Game.System.readResource(Input) },
    nextMachines: { mode: Game.System.nextState(Mode) }
  },
  ({ queries, resources, nextMachines }) => {
    const input = resources.input.get()
    // Either player can start a talk; the first one in slot order who can, does.
    const players = queries.players.each()
    for (const player of players) {
      const seat = player.data.seat.get()
      if (!input[seat].actions.action.pressed || player.data.stride.get().kind !== "still") continue
      const facing = player.data.facing.get()
      const target = cellInFront(player.data.tile.get(), facing)
      const other = players.find((match) => match.entity.id !== player.entity.id && sameCell(match.data.tile.get(), target))
      if (other !== undefined) {
        if (other.data.stride.get().kind !== "still") continue
        nextMachines.mode.set({
          _tag: "Talking",
          speaker: `Player ${playerNumber(seat)}`,
          pages: [`Ah, it's player ${playerNumber(other.data.seat.get())}.`, "Ritmo supports multiplayer, of course!"],
          page: 0,
          typed: 0
        })
        other.data.facing.set(opposite[facing])
        return
      }
      const found = queries.talkables.each().find((match) => sameCell(match.data.tile.get(), target))
      // Someone mid-step is not there yet: wait until they stand on the tile.
      if (found === undefined || (found.data.stride.value()?.kind ?? "still") !== "still") continue

      const { speaker, pages } = found.data.talkable.get()
      nextMachines.mode.set({ _tag: "Talking", speaker, pages, page: 0, typed: 0 })
      const listener = queries.listeners.get(found.entity.id)
      if (listener.ok) listener.value.data.facing.set(opposite[facing])
      return
    }
  }
)

/**
 * Types the open page out, one letter every `TYPE`. The letters typed change
 * every few steps, so they change at once (`update`), without waiting for a
 * mode change.
 */
export const TypeDialogue = Game.System(
  "Town/TypeDialogue",
  {
    resources: { time: Game.System.readResource(Time) },
    machines: { mode: Game.System.updateMachine(Mode) }
  },
  ({ resources, machines }) => {
    if (!Clock.every(resources.time.get(), TYPE)) return
    machines.mode.update({
      state: "Talking",
      data: (talking) => ({ ...talking, typed: Math.min(talking.typed + 1, (talking.pages[talking.page] ?? "").length) })
    })
  }
)

/** Whether any player pressed the action button in this update. */
const anyPressedAction = (input: Readonly<Record<SeatValue, { readonly actions: { readonly action: { readonly pressed: boolean } } }>>): boolean =>
  Players.slots.some((seat) => input[seat].actions.action.pressed)

/**
 * Either player's action button while talking: shows the rest of a page still typing,
 * else turns to the next page, else closes the dialogue and goes back to
 * `Exploring`.
 */
export const AdvanceDialogue = Game.System(
  "Town/AdvanceDialogue",
  {
    resources: { input: Game.System.readResource(Input) },
    machines: { mode: Game.System.updateMachine(Mode) },
    nextMachines: { mode: Game.System.nextState(Mode) }
  },
  ({ resources, machines, nextMachines }) => {
    if (!anyPressedAction(resources.input.get())) return
    const mode = machines.mode.get()
    // Gated on `Talking`: this only narrows the mode to its conversation.
    if (mode._tag !== "Talking") return
    const page = mode.pages[mode.page] ?? ""
    if (mode.typed < page.length) {
      machines.mode.update({ state: "Talking", data: (talking) => ({ ...talking, typed: page.length }) })
    } else if (mode.page + 1 < mode.pages.length) {
      machines.mode.update({ state: "Talking", data: (talking) => ({ ...talking, page: talking.page + 1, typed: 0 }) })
    } else {
      nextMachines.mode.set({ _tag: "Exploring" })
    }
  }
)
