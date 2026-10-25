// What the town's world holds: the components, resources, the input
// service, and the one game-wide mode. Headless: no page or renderer here.
import { Clock, Descriptor, Schema } from "@typeonce/ritmo"
import type { Gamepad, InputCapture, Keyboard, Touch } from "@typeonce/ritmo-browser"
import { Controls } from "@typeonce/ritmo-browser"
import * as Random from "@typeonce/ritmo/Random"
import { Schema as S } from "effect"

import { codec } from "../codec.ts"

import { directions } from "./map.ts"
import type { Cell, Character, Page } from "./map.ts"

/** One fixed update: 60 per second, shared by the clock and the host loop. */
export const step = Clock.hz(60)

/** A tile per 16 steps: one pixel per step, as on the handhelds. */
export const WALK = Clock.durationOfSteps(step, 16)
/** Turning to a new direction from rest waits this long before walking, so a tap only turns. */
export const TURN = Clock.durationOfSteps(step, 6)
/** Walking into something plays the step in place this long. */
export const BUMP = Clock.durationOfSteps(step, 20)
/** One more letter of dialogue every 2 steps. */
export const TYPE = Clock.durationOfSteps(step, 2)
/** How often a villager standing still may look somewhere else. */
export const LOOK_AROUND = Clock.duration(step, 1.5)
/** A pacing villager waits between this many steps and twice as many at each end of the route, drawn from `Rng`. */
export const PACE_REST = Clock.duration(step, 1)

// ── Input ───────────────────────────────────────────────────────────────

/**
 * The town's actions, bound on every device below. The directions are
 * buttons, not a vector: the town steps tile by tile, and a tap only turns.
 */
export const Actions = Controls.actions({ buttons: ["up", "down", "left", "right", "action", "back"] })

/** The second keyboard player: WASD to walk, Space or E to talk, Q to leave. Any of them joins. */
export const leftKeys = {
  up: ["w"],
  down: ["s"],
  left: ["a"],
  right: ["d"],
  action: [" ", "e"],
  back: ["q"]
} as const

/** The first player: arrows to walk, Enter to talk. In from the start, with no key to leave. */
export const rightKeys = {
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  action: ["Enter"]
} as const

/** The d-pad walks, south (A on Xbox) talks, east (B) leaves. Every pad is its own player. */
export const padBindings = {
  up: ["dpadUp"],
  down: ["dpadDown"],
  left: ["dpadLeft"],
  right: ["dpadRight"],
  action: ["south"],
  back: ["east"]
} as const

/** On a touch screen: an on-screen d-pad of four buttons and an A button (no leave button). */
export const touchButtons = ["up", "down", "left", "right", "action"] as const

/**
 * Two players: the first is in from the start (seated at setup), and a
 * second drops in and out: any button on a device nobody holds joins with
 * it (that press does nothing else), and back leaves.
 */
export const Players = Controls.players(Actions, { slots: ["p1", "p2"], join: "any", leave: "back" })

export type SeatValue = (typeof Players.slots)[number]

/** The one input source: every device pooled, built the same way in the browser and in the check. */
export const makePlayers = (devices: {
  readonly left: Keyboard.Actions<typeof leftKeys>
  readonly right: Keyboard.Actions<typeof rightKeys>
  readonly pads: Gamepad.Pads<typeof padBindings>
  readonly touch: Touch.Actions<(typeof touchButtons)[number]>
}) => Players.pool({
  left: devices.left,
  right: Actions.lacking(devices.right, ["back"]),
  pads: devices.pads,
  touch: Actions.lacking(devices.touch, ["back"])
})

/** The device the first player is seated on: the arrows, or the on-screen buttons on a touch screen. */
export type HostValue = "right" | "touch"

export const PlayersInput = Descriptor.Service<ReturnType<typeof makePlayers>>()("Town/Players")

// ── Components ──────────────────────────────────────────────────────────

/** The tile an actor stands on. A walking actor already holds the tile it walks to. */
export const Tile = Descriptor.Component<Cell>()("Town/Tile")
/** Where an actor is drawn: the top-left pixel, between tiles while walking. */
export const Position = Descriptor.Component<{ x: number; y: number }>()("Town/Position")
/** The way an actor faces: a closed set of values with no moves between them. */
export const Facing = Descriptor.ConstructedComponent(codec(S.Literals(directions)))("Town/Facing")
/** The character sheet an actor is drawn with, and a tint to tell the second player apart. */
export const Look = Descriptor.Component<{ character: Character; tint?: number }>()("Town/Look")
/** Facing it and pressing the action button opens these pages. */
export const Talkable = Descriptor.Component<{ speaker: string; pages: ReadonlyArray<Page> }>()("Town/Talkable")
/** Nobody can step onto its tile. */
export const Solid = Descriptor.Tag("Town/Solid")
export const Player = Descriptor.Tag("Town/Player")
/** Which player slot drives this player: its input is `Input[seat]`. */
export const Seat = Descriptor.Component<SeatValue>()("Town/Seat")
export const Villager = Descriptor.Tag("Town/Villager")
export const Signpost = Descriptor.Tag("Town/Signpost")

/**
 * A villager who paces between two tiles of one row or column: `heading`
 * is the end walked to, and `rest` the steps left to wait before moving on.
 */
export const Patrol = Descriptor.Component<{ ends: readonly [Cell, Cell]; heading: 0 | 1; rest: number }>()("Town/Patrol")

/** Which foot the next step lands on, for the walk animation. */
export type Foot = "left" | "right"

/**
 * What an actor's legs are doing. Every phase counts its own steps of the
 * clock (`elapsed`, from 1) up to its duration.
 *
 * - `still`: standing on `Tile`. `rested` is false right after a step, so a
 *   new direction turns and walks without the turning pause.
 * - `turn`: turned from rest; walks after `TURN` if the direction is held.
 * - `walk`: moving from `from` to `Tile`.
 * - `bump`: stepping in place against something solid.
 */
export type StrideValue =
  | { readonly kind: "still"; readonly foot: Foot; readonly rested: boolean }
  | { readonly kind: "turn"; readonly foot: Foot; readonly elapsed: number }
  | { readonly kind: "walk"; readonly foot: Foot; readonly elapsed: number; readonly from: Cell }
  | { readonly kind: "bump"; readonly foot: Foot; readonly elapsed: number }

export const Stride = Descriptor.Component<StrideValue>()("Town/Stride")

// ── Resources ───────────────────────────────────────────────────────────

export const Time = Clock.resource("Town/Time", step)
/** The villagers' look-around and pacing draws come from here, so a run replays exactly. */
export const Rng = Descriptor.ConstructedResource(Random.codec)("Town/Rng")
/** Captured from the players' devices at the start of each update; never saved. */
/** Which device the first player plays on; set by the host before setup. */
export const Host = Descriptor.Resource<HostValue>()("Town/Host")
export const Input = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof PlayersInput>>()("Town/Input")

export const Game = Schema.bind(
  Schema.fragment({
    components: { Tile, Position, Facing, Look, Talkable, Solid, Player, Seat, Villager, Signpost, Stride, Patrol },
    // What each kind of entity always has: spawning a villager without
    // pages to say does not compile.
    requires: [
      Schema.requires(Player, Seat, Tile, Position, Facing, Look, Stride, Solid),
      Schema.requires(Villager, Tile, Position, Facing, Look, Talkable, Solid),
      Schema.requires(Patrol, Villager, Stride),
      Schema.requires(Signpost, Tile, Position, Talkable, Solid)
    ],
    resources: { Time, Rng, Host, Input }
  }),
  Schema.defineRoot("Town")
)

/**
 * The game-wide mode. Walking, looking around, and starting a talk run only
 * while `Exploring`; while `Talking`, only the dialogue box listens, so the
 * world holds still. `Talking` holds the conversation on screen: who speaks,
 * their pages, the page shown, and how many of its letters have typed out,
 * so there is never a talk without a conversation, or one left open after it.
 */
export const Mode = Game.StateMachine("Town/Mode", {
  Exploring: {},
  Talking: codec(S.Struct({ speaker: S.String, pages: S.Array(S.String), page: S.Int, typed: S.Int }))
})
