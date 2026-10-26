/**
 * Gamepad input as caller-named actions, plus the sticks and triggers.
 *
 * Games bind actions to buttons once and read one snapshot per update, as
 * with `Keyboard`. The module owns the plumbing every game rewrites: polling
 * (the Gamepad API has no button events), press/release edges, a radial dead
 * zone on the sticks, following the pad that was used last when several are
 * connected, and releasing everything held when a pad disconnects. It does
 * not know about the ECS; `InputCapture.system(...)` copies snapshots from a
 * service into a resource.
 *
 * Buttons are named by their place in the browser's standard mapping
 * (`"south"` is A on Xbox, Cross on PlayStation, B on Nintendo), so bindings
 * stay the same on every pad. A pad whose `mapping` is not `"standard"` is
 * read by the same indices, which may not match its labels: let players
 * remap (`rebind`). The snapshot also reports every `button` by name,
 * whatever the bindings, for fixed menu navigation and for a settings screen
 * that waits for the button to bind; `parseRebinding(...)` validates
 * bindings saved as JSON.
 *
 * The Gamepad API has no button events, so the pads are read on every
 * animation frame and on every `snapshot()`; a tap that starts and ends
 * between two updates still counts. Browsers expose a pad only after
 * a button is pressed on it, and only in a secure context (HTTPS or
 * localhost); elsewhere, or when a permission policy blocks the API, the
 * live actions read no pad and report `connected: false`.
 *
 * `actions(...)` is one player on whichever pad is used. For local
 * multiplayer, `pads(host, bindings, max)` reads every pad on its own for
 * `Controls.players(...).pool(...)` (`scriptedPads(...)` in tests).
 *
 * @module Gamepad
 * @docGroup browser
 *
 * @example
 * ```ts
 * declare const move: (direction: Controls.Vector) => void
 * declare const attack: () => void
 * // ---cut---
 * const pad = Gamepad.actions(window, {
 *   move: Gamepad.vector({ stick: "left", up: ["dpadUp"], down: ["dpadDown"], left: ["dpadLeft"], right: ["dpadRight"] }),
 *   attack: ["west"],
 *   pause: ["start"]
 * })
 *
 * // Once per update:
 * const snapshot = pad.snapshot()
 * move(snapshot.vectors.move) // the stick's tilt, or the d-pad's direction
 * if (snapshot.actions.attack.pressed) attack()
 *
 * // In a settings screen, rebinding keeps the action names:
 * pad.rebind({ move: Gamepad.vector({ stick: "right" }), attack: ["north"], pause: ["start"] })
 * ```
 *
 * For tests, replays, and headless runs, `scripted(...)` plays a timeline of
 * button presses, releases, and stick moves instead of polling a host, and
 * `recording(...)` wraps live actions to capture the timeline a session
 * produced. `parseTimeline(...)` validates a timeline loaded from JSON.
 */
import type * as System from "@typeonce/ritmo/System"
import * as Result from "@typeonce/ritmo/Result"

import type * as BrowserTickSource from "./BrowserTickSource.ts"
import type { ActionState } from "./internal/state.ts"
import type { Vector } from "./internal/vectors.ts"
import * as ButtonsInternal from "./internal/buttons.ts"
import { buttonTracker, flattenButtons, idleActions, idleButtons, idleVectors, splitActions } from "./internal/buttons.ts"
import { digital, isVectorBinding, longer } from "./internal/vectors.ts"
import { anyUsed } from "./internal/used.ts"

/**
 * The buttons of the browser's standard mapping, in index order: face
 * buttons by compass position, bumpers and triggers, the two small center
 * buttons, the stick clicks, the d-pad, and the home button.
 */
export const buttonNames = [
  "south",
  "east",
  "west",
  "north",
  "leftBumper",
  "rightBumper",
  "leftTrigger",
  "rightTrigger",
  "select",
  "start",
  "leftStick",
  "rightStick",
  "dpadUp",
  "dpadDown",
  "dpadLeft",
  "dpadRight",
  "home"
] as const

/** One button of the standard mapping, see {@link buttonNames}. */
export type Button = (typeof buttonNames)[number]

/** The buttons of one action: at least one. */
export type Buttons = readonly [Button, ...Array<Button>]

/** The two sticks a vector action can read. */
export type StickName = "left" | "right"

/**
 * A vector action (movement) on the pad, built with {@link vector}: a
 * stick, buttons for the four directions (the d-pad), or both.
 */
export interface VectorBinding {
  readonly _tag: "Vector"
  readonly stick?: StickName
  readonly up?: Buttons
  readonly down?: Buttons
  readonly left?: Buttons
  readonly right?: Buttons
}

/**
 * Action name to the buttons that trigger it (at least one), or to a
 * {@link vector} binding for a direction such as movement.
 */
export type Bindings = Readonly<Record<string, Buttons | VectorBinding>>

/** The bound button actions: the names bound to buttons. */
export type ButtonNames<B> = { [K in keyof B]: B[K] extends VectorBinding ? never : K }[keyof B] & string

/** The bound vector actions: the names bound with {@link vector}. */
export type VectorNames<B> = { [K in keyof B]: B[K] extends VectorBinding ? K : never }[keyof B] & string

/**
 * Binds a vector action to a stick, to buttons for its four directions, or
 * to both. The snapshot's `vectors` reports the longer of the two: the
 * stick keeps its tilt (after the dead zone), and the buttons give length 1
 * (a diagonal is not faster).
 *
 * @example
 * ```ts
 * const bindings = {
 *   move: Gamepad.vector({ stick: "left", up: ["dpadUp"], down: ["dpadDown"], left: ["dpadLeft"], right: ["dpadRight"] }),
 *   jump: ["south"]
 * } as const
 * ```
 */
export const vector = (
  binding:
    | { readonly stick: StickName }
    | { readonly stick?: StickName; readonly up: Buttons; readonly down: Buttons; readonly left: Buttons; readonly right: Buttons }
): VectorBinding => ({ _tag: "Vector", ...binding })

/**
 * New buttons for the same actions, for {@link Actions.rebind}: buttons for
 * a button action, a {@link vector} for a vector action. Load saved ones
 * with {@link parseRebinding}.
 */
export type Rebinding<B extends Bindings> = { readonly [Action in keyof B]: B[Action] extends VectorBinding ? VectorBinding : Buttons }

/** One button's reading, the subset of the browser's `GamepadButton` the module reads. */
export interface ButtonReading {
  readonly pressed: boolean
  readonly value: number
}

/** One pad's reading, the subset of the browser's `Gamepad` the module reads. */
export interface PadReading {
  readonly id: string
  readonly index: number
  readonly connected: boolean
  readonly mapping: string
  readonly buttons: ReadonlyArray<ButtonReading>
  readonly axes: ReadonlyArray<number>
}

/** Where pads are read from, the subset of the browser's `navigator` the module reads. */
export interface GamepadNavigator {
  getGamepads(): ReadonlyArray<PadReading | null>
}

/**
 * What live actions need from the window: the pads, and animation frames to
 * read them on, since the Gamepad API has no button events.
 */
export interface GamepadHost extends BrowserTickSource.Host {
  readonly navigator: GamepadNavigator
}

/**
 * The followed pad's state, with the same core as the other devices'
 * snapshots (`actions`, `vectors`, and `used`) so `Controls` can merge it.
 * With no pad everything is idle and `connected` is `false`.
 */
export interface Snapshot<B extends Bindings> {
  /** Every bound button action's state. */
  readonly actions: { readonly [Action in ButtonNames<B>]: ActionState }
  /** Each vector action's direction, length at most 1, `y` growing down. */
  readonly vectors: { readonly [Action in VectorNames<B>]: Vector }
  /** Every button's state by name, whatever the bindings. */
  readonly buttons: { readonly [Name in Button]: ActionState }
  /** The left stick's tilt, whatever the bindings. */
  readonly left: Vector
  /** The right stick's tilt, whatever the bindings. */
  readonly right: Vector
  /** How far the left trigger is pulled, 0 to 1. */
  readonly leftTrigger: number
  /** How far the right trigger is pulled, 0 to 1. */
  readonly rightTrigger: number
  /**
   * Some button was pressed in this window or is held, or a stick is past
   * the dead zone: the player is using the pad.
   */
  readonly used: boolean
  /** Whether a pad is being followed. */
  readonly connected: boolean
  /** The followed pad's `id` (it names the maker, for button labels), or `null`. */
  readonly id: string | null
}

/**
 * Rejects actions a rebinding names that the bindings do not have, so
 * {@link Actions.rebind} takes exactly the actions it was made with.
 */
export type OnlyActionsOf<R, B extends Bindings> = {
  readonly [Name in Exclude<keyof R, keyof B>]: `${Name & string} is not an action of these bindings`
}

/**
 * A pad bound to actions, built with {@link actions} (live), {@link scripted},
 * or {@link recording}. Capture it with `InputCapture.system(...)`, or merge
 * it with `Controls`.
 */
export interface Actions<B extends Bindings> extends System.Consumes<"snapshot"> {
  /** Returns the input state and starts a new press/release window. */
  snapshot(): Snapshot<B>
  /**
   * Binds the same actions to new buttons, from the next snapshot, for a
   * settings screen where players remap controls (capture the button to bind
   * from the snapshot's `buttons`). An action held only through buttons it
   * lost reports `released`. A button held across the rebind holds a newly
   * bound action only once it is pressed again, so an action never turns
   * held without a press. It takes exactly the actions the source was made
   * with.
   */
  rebind<const R extends Rebinding<B>>(bindings: R & OnlyActionsOf<R, B>): void
  /** Stops reading pads and cancels the animation frame. */
  dispose(): void
}

/** Options for {@link actions} and {@link pads}. */
export interface ActionsOptions {
  /** Fraction of a stick's tilt that reads as zero. Defaults to 0.15. */
  readonly deadZone?: number
  /** How far a trigger is pulled before it counts as held. Defaults to 0.5. */
  readonly triggerThreshold?: number
}

const zero: Vector = { x: 0, y: 0 }


/**
 * A snapshot with nothing held and no pad, for initializing an input
 * resource before the first capture.
 */
export const idle = <const B extends Bindings>(bindings: B): Snapshot<B> => {
  return { actions: idleActions(bindings), vectors: idleVectors(bindings) as Snapshot<B>["vectors"], buttons: idleButtons(buttonNames), left: zero, right: zero, leftTrigger: 0, rightTrigger: 0, used: false, connected: false, id: null }
}

const sameVector = (a: Vector, b: Vector): boolean => a.x === b.x && a.y === b.y

/** Removes the dead zone and rescales, so the stick goes from zero to full tilt smoothly. */
const stick = (x: number, y: number, deadZone: number): Vector => {
  const length = Math.sqrt(x * x + y * y)
  if (length <= deadZone) return zero
  const scaled = Math.min(1, (length - deadZone) / (1 - deadZone))
  return { x: (x / length) * scaled, y: (y / length) * scaled }
}

/** The button tracker with the pad's analog state, shared by live and scripted actions. */
const tracker = <B extends Bindings>(initial: B) => {
  // Vector actions are tracked as their four directions, next to the button actions.
  let bindings: Bindings = initial
  const buttons = buttonTracker(buttonNames, flattenButtons<Button>(initial))
  return {
    held: buttons.held,
    down: buttons.down,
    up: buttons.up,
    upAll: buttons.upAll,
    rebind(next: Rebinding<B>) {
      bindings = next
      buttons.rebind(flattenButtons<Button>(next))
    },
    snapshot(analog: Omit<Snapshot<B>, "actions" | "vectors" | "buttons" | "used">): Snapshot<B> {
      const taken = buttons.take()
      // The actions are fixed at creation; a rebind only changes how each is bound.
      const { actions, held } = splitActions(initial, taken.actions)
      const vectors: Record<string, Vector> = {}
      for (const [name, entry] of Object.entries(initial)) {
        if (!isVectorBinding(entry)) continue
        const binding = bindings[name] as VectorBinding
        const pad = digital(held(name, "up"), held(name, "down"), held(name, "left"), held(name, "right"))
        vectors[name] = binding.stick === undefined ? pad : longer(analog[binding.stick], pad)
      }
      const used = anyUsed(taken.buttons) || !sameVector(analog.left, zero) || !sameVector(analog.right, zero)
      return { actions, vectors, buttons: taken.buttons, ...analog, used } as Snapshot<B>
    }
  }
}

/** Whether a pad is being touched: a button down or a stick past the dead zone. */
const inUse = (pad: PadReading, deadZone: number, triggerThreshold: number): boolean =>
  pad.buttons.some((button, index) => isDown(button, index, triggerThreshold)) ||
  // Only the sticks' axes: some pads report their triggers as extra axes resting at -1.
  pad.axes.slice(0, 4).some((axis) => Math.abs(axis) > deadZone)

const triggerIndices = new Set([6, 7])

const isDown = (button: ButtonReading, index: number, triggerThreshold: number): boolean =>
  triggerIndices.has(index) ? button.value >= triggerThreshold : button.pressed

/** Reads the pads, treating a host that throws (a blocked permission policy) as having none. */
const readPads = (host: GamepadHost): ReadonlyArray<PadReading | null> => {
  try {
    return host.navigator.getGamepads()
  } catch {
    return []
  }
}

/**
 * Starts reading pads from `host`, usually `window`, on every animation
 * frame until `dispose()`. With several pads connected it follows the one
 * used last; switching pads, or the followed pad disconnecting, releases
 * everything it held. Use {@link pads} to give each pad its own player.
 */
export const actions = <const B extends Bindings>(host: GamepadHost, bindings: B, options: ActionsOptions = {}): Actions<B> => {
  const deadZone = options.deadZone ?? 0.15
  const triggerThreshold = options.triggerThreshold ?? 0.5
  const state = tracker(bindings)
  let followed: number | null = null
  let disposed = false
  let reading: PadReading | null = null
  let frame = 0

  const poll = (): void => {
    if (disposed) return
    const pads = readPads(host).filter((pad): pad is PadReading => pad !== null && pad.connected)
    const current = pads.find((pad) => pad.index === followed)
    // Keep the followed pad while it is in use; otherwise switch to another one being used, or keep the first there is.
    const used = current !== undefined && inUse(current, deadZone, triggerThreshold)
      ? current
      : pads.find((pad) => pad.index !== followed && inUse(pad, deadZone, triggerThreshold))
    const next = used ?? current ?? pads[0]
    if (next?.index !== followed) state.upAll()
    followed = next?.index ?? null
    reading = next ?? null
    if (next === undefined) return
    readButtons(state, next, triggerThreshold)
  }

  const onFrame = (): void => {
    if (disposed) return
    poll()
    frame = host.requestAnimationFrame(onFrame)
  }
  frame = host.requestAnimationFrame(onFrame)

  return {
    snapshot() {
      poll()
      const pad = reading
      if (pad === null) return state.snapshot({ ...resting, connected: false, id: null })
      return state.snapshot({ ...analogOf(pad, deadZone), connected: true, id: pad.id })
    },
    rebind: state.rebind,
    dispose() {
      if (disposed) return
      disposed = true
      host.cancelAnimationFrame(frame)
      reading = null
      state.upAll()
    }
  }
}

/**
 * Every pad connected to the browser, each one on its own: what
 * `Controls.players(...).pool(...)` hands to the player who joins with it.
 * Use {@link actions} for one player, which follows whichever pad is used.
 */
export interface Pads<B extends Bindings> extends System.Consumes<"snapshot"> {
  readonly _tag: "Pads"
  /** The most pads read at once: their places in the list run from 0 to `max - 1`. */
  readonly max: number
  /**
   * One snapshot per pad seen so far, in the order they appeared, and
   * starts a new press/release window on each. An unplugged pad stays in
   * the list with `connected: false` and its last `id`, so a player keeps
   * it until it comes back.
   */
  snapshot(): ReadonlyArray<Snapshot<B>>
  /** Binds the same actions to new buttons on every pad, as {@link Actions.rebind}. */
  rebind<const R extends Rebinding<B>>(bindings: R & OnlyActionsOf<R, B>): void
  /** Stops reading pads and cancels the animation frame. */
  dispose(): void
}

/** Presses and releases `state`'s buttons as `pad` reads now. */
const readButtons = (state: ReturnType<typeof tracker>, pad: PadReading, triggerThreshold: number): void => {
  for (let index = 0; index < buttonNames.length; index++) {
    const button = pad.buttons[index]
    const name = buttonNames[index]!
    if (button !== undefined && isDown(button, index, triggerThreshold)) state.down(name)
    else state.up(name)
  }
}

/** A pad's sticks (dead zone removed) and triggers. */
const analogOf = (pad: PadReading, deadZone: number) => {
  const axis = (index: number) => pad.axes[index] ?? 0
  const trigger = (index: number) => Math.min(1, Math.max(0, pad.buttons[index]?.value ?? 0))
  return {
    left: stick(axis(0), axis(1), deadZone),
    right: stick(axis(2), axis(3), deadZone),
    leftTrigger: trigger(6),
    rightTrigger: trigger(7)
  }
}

const resting = { left: zero, right: zero, leftTrigger: 0, rightTrigger: 0 }

/** Rejects a pad count that is not a whole number literal of 1 or more. */
type PadCount<N extends number> = number extends N
  ? "max must be a number literal, like 4: the most pads read at once"
  : `${N}` extends `-${string}` | `${string}.${string}` | "0"
    ? "max must be a whole number of pads, 1 or more"
    : N

/**
 * Starts reading every pad on `host`, usually `window`, up to `max` of
 * them, each with its own presses and sticks; pads beyond `max` are
 * ignored. A pad keeps its place in the list while unplugged; one that comes
 * back at the same browser index continues it, and a different pad at that
 * index takes the place over with nothing held. `max` is a whole number
 * literal, 1 or more: the most players the game seats on pads.
 */
export const pads = <const B extends Bindings, const N extends number>(host: GamepadHost, bindings: B, max: PadCount<N>, options: ActionsOptions = {}): Pads<B> => {
  const limit = max as number
  const deadZone = options.deadZone ?? 0.15
  const triggerThreshold = options.triggerThreshold ?? 0.5
  const seen: Array<{ readonly index: number; readonly state: ReturnType<typeof tracker<B>>; id: string | null; reading: PadReading | null }> = []
  let disposed = false
  let frame = 0

  const poll = (): void => {
    if (disposed) return
    const connected = readPads(host).filter((pad): pad is PadReading => pad !== null && pad.connected)
    for (const pad of connected) {
      if (seen.length < limit && !seen.some((entry) => entry.index === pad.index)) {
        seen.push({ index: pad.index, state: tracker(bindings), id: pad.id, reading: null })
      }
    }
    for (const entry of seen) {
      const pad = connected.find((reading) => reading.index === entry.index)
      // Unplugged, or another pad took the index: everything it held is released.
      if (pad === undefined || pad.id !== entry.id) {
        if (entry.reading !== null) entry.state.upAll()
        entry.reading = null
        if (pad === undefined) continue
        entry.id = pad.id
      }
      entry.reading = pad
      readButtons(entry.state, pad, triggerThreshold)
    }
  }

  const onFrame = (): void => {
    if (disposed) return
    poll()
    frame = host.requestAnimationFrame(onFrame)
  }
  frame = host.requestAnimationFrame(onFrame)

  return {
    _tag: "Pads",
    max: limit,
    snapshot() {
      poll()
      return seen.map((entry) => entry.state.snapshot(entry.reading === null
        ? { ...resting, connected: false, id: entry.id }
        : { ...analogOf(entry.reading, deadZone), connected: true, id: entry.id }))
    },
    rebind(next) {
      for (const entry of seen) entry.state.rebind(next)
      // Pads that appear later start with the new bindings too.
      bindings = next as unknown as B
    },
    dispose() {
      if (disposed) return
      disposed = true
      host.cancelAnimationFrame(frame)
      for (const entry of seen) entry.state.upAll()
    }
  }
}

/**
 * Pads driven by timelines instead of a host, one timeline per pad (as
 * {@link scripted}), each with the id `scripted <n>` (from `scripted 1`)
 * and `max` the number of timelines: for tests of games where every player
 * has a pad.
 *
 * Unlike {@link pads}, every timeline is in the list from the first
 * snapshot, with its id even while unplugged. Each pad connects at its
 * timeline's first entry, so a pad plugged in later is a timeline that
 * starts later, and an entry with `connected: false` unplugs it.
 */
export const scriptedPads = <const B extends Bindings>(bindings: B, timelines: ReadonlyArray<Timeline>): Pads<B> => {
  const each = timelines.map((timeline) => scripted(bindings, timeline))
  return {
    _tag: "Pads",
    max: each.length,
    snapshot: () => each.map((pad, index) => ({ ...pad.snapshot(), id: `scripted ${index + 1}` })),
    rebind(next) {
      for (const pad of each) pad.rebind(next as never)
    },
    dispose() {}
  }
}

/**
 * Input changes applied just before one snapshot: the buttons, then the
 * sticks and triggers, which keep their value until set again, then
 * `connected`. `frame` is the snapshot's index, counting from 0 at the first
 * `snapshot()` call. A button in both `press` and `release` changed twice
 * within the frame: a tap shorter than a frame when it was up, a release and
 * a new press when it was held.
 */
export interface TimelineEntry {
  readonly frame: number
  /**
   * Connects or disconnects the pad from this frame on. The first entry
   * connects it unless it says otherwise. A disconnect releases every held
   * button and zeroes the sticks and triggers, as with a live pad.
   */
  readonly connected?: boolean
  readonly press?: ReadonlyArray<Button>
  readonly release?: ReadonlyArray<Button>
  readonly left?: Vector
  readonly right?: Vector
  readonly leftTrigger?: number
  readonly rightTrigger?: number
}

/**
 * Input changes by snapshot index. Plain data, so it round-trips through
 * JSON; load it back with `parseTimeline`. It names buttons, not actions, so
 * a replay follows the bindings as live play does.
 */
export type Timeline = ReadonlyArray<TimelineEntry>

/** Actions driven by a timeline instead of a host. */
export interface Scripted<B extends Bindings> extends Actions<B> {
  /** Number of snapshots taken so far, which is the next frame index. */
  readonly frames: () => number
}

/**
 * Plays `timeline`: before the snapshot at index `frame`, every entry for
 * that frame is applied. A pad counts as connected (with the id
 * `"scripted"`) from the first entry on, until an entry says
 * `connected: false`; `scripted(bindings, [])` is a pad that never connects.
 * Buttons stay held from their press until their release; pressing a held
 * button is not a new press.
 */
export const scripted = <const B extends Bindings>(bindings: B, timeline: Timeline): Scripted<B> => {
  const state = tracker(bindings)
  const byFrame = new Map<number, Array<TimelineEntry>>()
  for (const entry of timeline) {
    const entries = byFrame.get(entry.frame)
    if (entries) entries.push(entry)
    else byFrame.set(entry.frame, [entry])
  }
  const first = timeline.reduce((earliest, entry) => Math.min(earliest, entry.frame), Number.POSITIVE_INFINITY)
  const resting = { left: zero, right: zero, leftTrigger: 0, rightTrigger: 0 }
  let analog = resting
  let connected = false
  let frame = 0
  return {
    snapshot() {
      for (const entry of byFrame.get(frame) ?? []) {
        const releases = new Set(entry.release ?? [])
        for (const button of entry.press ?? []) {
          if (state.held.has(button) && releases.has(button)) {
            // Released and pressed again within the frame.
            releases.delete(button)
            state.up(button)
          }
          state.down(button)
        }
        for (const button of releases) state.up(button)
        analog = {
          left: entry.left ?? analog.left,
          right: entry.right ?? analog.right,
          leftTrigger: entry.leftTrigger ?? analog.leftTrigger,
          rightTrigger: entry.rightTrigger ?? analog.rightTrigger
        }
        connected = entry.connected ?? (frame === first ? true : connected)
        if (!connected) {
          state.upAll()
          analog = resting
        }
      }
      frame += 1
      return state.snapshot({ ...analog, connected, id: connected ? "scripted" : null })
    },
    rebind: state.rebind,
    dispose() {},
    frames: () => frame
  }
}

/** Live actions that also record the timeline they produce. */
export interface Recording<B extends Bindings> extends Actions<B> {
  /** The recorded timeline; `scripted(bindings, timeline)` replays it exactly. */
  readonly timeline: () => Timeline
}

/**
 * Wraps `actions` and records, for every snapshot, the buttons pressed and
 * released since the previous one and the sticks and triggers that moved.
 */
export const recording = <B extends Bindings>(actions: Actions<B>): Recording<B> => {
  const entries: Array<TimelineEntry> = []
  let previous: Omit<Snapshot<B>, "actions" | "vectors" | "id" | "used"> = { buttons: idleButtons(buttonNames), left: zero, right: zero, leftTrigger: 0, rightTrigger: 0, connected: false }
  let frame = 0
  return {
    snapshot() {
      const snapshot = actions.snapshot()
      const press = buttonNames.filter((name) => snapshot.buttons[name].pressed)
      // A press of a button held at the previous snapshot means it was released in between.
      const release = buttonNames.filter((name) => snapshot.buttons[name].released || (snapshot.buttons[name].pressed && previous.buttons[name].held))
      const entry: Record<string, unknown> = {
        ...(press.length > 0 ? { press } : {}),
        ...(release.length > 0 ? { release } : {}),
        ...(sameVector(snapshot.left, previous.left) ? {} : { left: snapshot.left }),
        ...(sameVector(snapshot.right, previous.right) ? {} : { right: snapshot.right }),
        ...(snapshot.leftTrigger === previous.leftTrigger ? {} : { leftTrigger: snapshot.leftTrigger }),
        ...(snapshot.rightTrigger === previous.rightTrigger ? {} : { rightTrigger: snapshot.rightTrigger }),
        // The first entry connects the pad by itself; later changes are written out.
        ...(snapshot.connected === previous.connected || entries.length === 0 ? {} : { connected: snapshot.connected })
      }
      // The first entry also marks when a pad appeared, so a replay connects on the same frame.
      if (Object.keys(entry).length > 0 || (entries.length === 0 && snapshot.connected)) entries.push({ frame, ...entry })
      previous = snapshot
      frame += 1
      return snapshot
    },
    rebind: (bindings) => actions.rebind(bindings),
    dispose: () => actions.dispose(),
    timeline: () => [...entries]
  }
}

/**
 * Why loaded data is not a timeline. `path` points at the offending value,
 * for example `[3].press[0]`.
 */
export interface InvalidTimeline {
  readonly _tag: "InvalidTimeline"
  readonly path: string
  readonly message: string
}

const buttonSet: ReadonlySet<string> = new Set(buttonNames)

/** Whether `name` is a button of the standard mapping, for validating stored bindings. */
export const isButton = (name: unknown): name is Button => typeof name === "string" && buttonSet.has(name)

/**
 * Validates untrusted data, such as a parsed JSON file, as a timeline: an
 * array of entries with a non-negative integer `frame`, optional
 * `press`/`release` arrays of button names, optional `left`/`right` vectors
 * of length at most 1, optional triggers from 0 to 1, and an optional
 * boolean `connected`.
 */
export const parseTimeline = (data: unknown): Result.Result<Timeline, InvalidTimeline> => {
  const invalid = (path: string, message: string) => Result.failure<InvalidTimeline>({ _tag: "InvalidTimeline", path, message })
  if (!Array.isArray(data)) return invalid("", "expected an array of entries")
  const entries: Array<TimelineEntry> = []
  for (let index = 0; index < data.length; index++) {
    const entry: unknown = data[index]
    const path = `[${index}]`
    if (typeof entry !== "object" || entry === null) return invalid(path, "expected an object")
    const fields = entry as Readonly<Record<string, unknown>>
    const frame = fields["frame"]
    if (typeof frame !== "number" || !Number.isInteger(frame) || frame < 0) return invalid(`${path}.frame`, "expected a non-negative integer")
    const parsed: Record<string, unknown> = { frame }
    for (const field of ["press", "release"] as const) {
      const value = fields[field]
      if (value === undefined) continue
      if (!Array.isArray(value)) return invalid(`${path}.${field}`, "expected an array of button names")
      for (let offset = 0; offset < value.length; offset++) {
        if (!isButton(value[offset])) return invalid(`${path}.${field}[${offset}]`, `expected one of ${buttonNames.join(", ")}`)
      }
      parsed[field] = [...value]
    }
    for (const field of ["left", "right"] as const) {
      const value = fields[field]
      if (value === undefined) continue
      const { x, y } = (typeof value === "object" && value !== null ? value : {}) as { readonly x?: unknown; readonly y?: unknown }
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || x * x + y * y > 1 + 1e-9) {
        return invalid(`${path}.${field}`, "expected { x, y } of length at most 1")
      }
      parsed[field] = { x, y }
    }
    for (const field of ["leftTrigger", "rightTrigger"] as const) {
      const value = fields[field]
      if (value === undefined) continue
      if (typeof value !== "number" || !(value >= 0 && value <= 1)) return invalid(`${path}.${field}`, "expected a number from 0 to 1")
      parsed[field] = value
    }
    const connected = fields["connected"]
    if (connected !== undefined) {
      if (typeof connected !== "boolean") return invalid(`${path}.connected`, "expected a boolean")
      parsed["connected"] = connected
    }
    entries.push(parsed as unknown as TimelineEntry)
  }
  return Result.success(entries)
}

/**
 * Why loaded data is not a rebinding for the bindings. `path` points at the
 * offending value, for example `attack[1]`.
 */
export type InvalidRebinding = ButtonsInternal.InvalidRebinding

/**
 * Validates untrusted data, such as saved settings parsed from JSON, as new
 * buttons for `bindings`: an object with exactly the same action names, each
 * mapped to a non-empty array of button names (for a vector action, an
 * object with an optional `stick` and buttons for all four directions or
 * none, as `Gamepad.vector` saves). Pass the result to
 * {@link Actions.rebind}; on failure, keep the defaults.
 *
 * @example
 * ```ts
 * const bindings = { move: Gamepad.vector({ stick: "left" }), jump: ["south"] } as const
 * const pad = Gamepad.actions(window, bindings)
 * declare const stored: string
 * // ---cut---
 * const saved = Gamepad.parseRebinding(bindings, JSON.parse(stored))
 * if (saved.ok) pad.rebind(saved.value)
 * ```
 */
export const parseRebinding = <const B extends Bindings>(
  bindings: B,
  data: unknown
): Result.Result<Rebinding<B>, InvalidRebinding> =>
  // The checked names and buttons are exactly `Rebinding<B>`.
  ButtonsInternal.parseButtonRebinding(buttonNames, bindings, data, ["left", "right"]) as Result.Result<Rebinding<B>, InvalidRebinding>
