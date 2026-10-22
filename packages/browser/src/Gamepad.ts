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
 * that waits for the button to bind.
 *
 * Polling happens on every `snapshot()`. A press and release that both fall
 * between two snapshots is missed unless the host also calls `poll()` more
 * often (each animation frame, for example). Browsers expose a pad only after
 * a button is pressed on it, and only in a secure context (HTTPS or
 * localhost); elsewhere `navigator.getGamepads` is missing, and a game uses
 * `scripted(bindings, [])` as an idle stand-in.
 *
 * @module Gamepad
 * @docGroup browser
 *
 * @example
 * ```ts
 * const pad = Gamepad.actions(navigator, {
 *   attack: ["west"],
 *   dash: ["south"],
 *   pause: ["start"]
 * })
 *
 * // Each animation frame (optional), so taps shorter than an update count:
 * pad.poll()
 *
 * // Once per update:
 * const snapshot = pad.snapshot()
 * move(snapshot.left)
 * if (snapshot.actions.attack.pressed) attack()
 *
 * // In a settings screen, rebinding keeps the action names:
 * pad.rebind({ attack: ["north"], dash: ["south"], pause: ["start"] })
 * ```
 *
 * For tests, replays, and headless runs, `scripted(...)` plays a timeline of
 * button presses, releases, and stick moves instead of polling a host, and
 * `recording(...)` wraps live actions to capture the timeline a session
 * produced. `parseTimeline(...)` validates a timeline loaded from JSON.
 */
import * as Result from "@typeonce/ritmo/Result"

import type { ActionState } from "./Keyboard.ts"

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

/**
 * Action name to the buttons that trigger it. Every action needs at least
 * one button.
 */
export type Bindings = Readonly<Record<string, readonly [Button, ...Array<Button>]>>

/** New buttons for the same actions, for {@link Actions.rebind}. */
export type Rebinding<B extends Bindings> = { readonly [Action in keyof B]: readonly [Button, ...Array<Button>] }

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

/** Where pads are read from, usually `navigator`. */
export interface GamepadHost {
  getGamepads(): ReadonlyArray<PadReading | null>
}

/** A stick's tilt with the dead zone removed: zero at rest, length 1 at full tilt. `y` grows down, as on screen. */
export interface Vector {
  readonly x: number
  readonly y: number
}

export interface Snapshot<B extends Bindings> {
  /** Every bound action's state. */
  readonly actions: { readonly [Action in keyof B]: ActionState }
  /** Every button's state by name, whatever the bindings. */
  readonly buttons: { readonly [Name in Button]: ActionState }
  readonly left: Vector
  readonly right: Vector
  /** How far each trigger is pulled, 0 to 1. */
  readonly leftTrigger: number
  readonly rightTrigger: number
  /** Whether a pad is being followed. */
  readonly connected: boolean
  /** The followed pad's `id` (it names the maker, for button labels), or `null`. */
  readonly id: string | null
}

export interface Actions<B extends Bindings> {
  /** Returns the input state and starts a new press/release window. */
  snapshot(): Snapshot<B>
  /** Reads the pads now, so a press shorter than one update still counts. `snapshot()` polls too. */
  poll(): void
  /**
   * Binds the same actions to new buttons, from the next snapshot. An action
   * held only through buttons it lost reports `released`.
   */
  rebind(bindings: Rebinding<B>): void
  /** Stops reading pads. */
  dispose(): void
}

export interface ActionsOptions {
  /** Fraction of a stick's tilt that reads as zero. Defaults to 0.15. */
  readonly deadZone?: number
  /** How far a trigger is pulled before it counts as held. Defaults to 0.5. */
  readonly triggerThreshold?: number
}

const idleState: ActionState = { held: false, pressed: false, released: false }
const zero: Vector = { x: 0, y: 0 }

const idleButtons = (): Snapshot<Bindings>["buttons"] => {
  const buttons = {} as Record<Button, ActionState>
  for (const name of buttonNames) buttons[name] = idleState
  return buttons
}

/**
 * A snapshot with nothing held and no pad, for initializing an input
 * resource before the first capture.
 */
export const idle = <const B extends Bindings>(bindings: B): Snapshot<B> => {
  const actions = {} as Record<keyof B, ActionState>
  for (const name of Object.keys(bindings) as Array<keyof B>) actions[name] = idleState
  return { actions, buttons: idleButtons() as Snapshot<B>["buttons"], left: zero, right: zero, leftTrigger: 0, rightTrigger: 0, connected: false, id: null }
}

/** Removes the dead zone and rescales, so the stick goes from zero to full tilt smoothly. */
const stick = (x: number, y: number, deadZone: number): Vector => {
  const length = Math.sqrt(x * x + y * y)
  if (length <= deadZone) return zero
  const scaled = Math.min(1, (length - deadZone) / (1 - deadZone))
  return { x: (x / length) * scaled, y: (y / length) * scaled }
}

/**
 * The held buttons and the edges since the previous snapshot, shared by live
 * and scripted actions so both build snapshots the same way.
 */
const tracker = <B extends Bindings>(initial: B) => {
  let bindings: Rebinding<B> = initial
  let names = Object.keys(initial) as Array<keyof B & string>
  const held = new Set<Button>()
  const pressed = new Set<Button>()
  const released = new Set<Button>()
  /** Actions that lost their held buttons in a rebind, reported released on the next snapshot. */
  const droppedActions = new Set<keyof B>()
  const isHeld = (name: keyof B & string): boolean => bindings[name]!.some((button) => held.has(button))
  return {
    held,
    down(button: Button) {
      if (held.has(button)) return
      held.add(button)
      pressed.add(button)
    },
    up(button: Button) {
      if (held.delete(button)) released.add(button)
    },
    upAll() {
      for (const button of held) released.add(button)
      held.clear()
    },
    rebind(next: Rebinding<B>) {
      const before = names.filter(isHeld)
      bindings = next
      names = Object.keys(next) as Array<keyof B & string>
      for (const name of before) if (!isHeld(name)) droppedActions.add(name)
    },
    snapshot(analog: Pick<Snapshot<B>, "left" | "right" | "leftTrigger" | "rightTrigger" | "connected" | "id">): Snapshot<B> {
      const buttons = {} as Record<Button, ActionState>
      for (const name of buttonNames) {
        const isDown = held.has(name)
        buttons[name] = isDown || pressed.has(name) || released.has(name)
          ? { held: isDown, pressed: pressed.has(name), released: released.has(name) && !isDown }
          : idleState
      }
      const actions = {} as Record<keyof B, ActionState>
      for (const name of names) {
        const bound = bindings[name]!
        const isDown = bound.some((button) => held.has(button))
        actions[name] = {
          held: isDown,
          pressed: bound.some((button) => pressed.has(button)),
          released: !isDown && (droppedActions.has(name) || bound.some((button) => released.has(button)))
        }
      }
      pressed.clear()
      released.clear()
      droppedActions.clear()
      return { actions, buttons, ...analog }
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
    return host.getGamepads()
  } catch {
    return []
  }
}

/**
 * Starts reading pads from `host`. With several pads connected it follows
 * the one used last; a pad that disconnects releases everything it held.
 */
export const actions = <const B extends Bindings>(host: GamepadHost, bindings: B, options: ActionsOptions = {}): Actions<B> => {
  const deadZone = options.deadZone ?? 0.15
  const triggerThreshold = options.triggerThreshold ?? 0.5
  const state = tracker(bindings)
  let followed: number | null = null
  let disposed = false
  let reading: PadReading | null = null

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
    for (let index = 0; index < buttonNames.length; index++) {
      const button = next.buttons[index]
      const name = buttonNames[index]!
      if (button !== undefined && isDown(button, index, triggerThreshold)) state.down(name)
      else state.up(name)
    }
  }

  return {
    snapshot() {
      poll()
      const pad = reading
      if (pad === null) return state.snapshot({ left: zero, right: zero, leftTrigger: 0, rightTrigger: 0, connected: false, id: null })
      const axis = (index: number) => pad.axes[index] ?? 0
      const trigger = (index: number) => Math.min(1, Math.max(0, pad.buttons[index]?.value ?? 0))
      return state.snapshot({
        left: stick(axis(0), axis(1), deadZone),
        right: stick(axis(2), axis(3), deadZone),
        leftTrigger: trigger(6),
        rightTrigger: trigger(7),
        connected: true,
        id: pad.id
      })
    },
    poll,
    rebind: state.rebind,
    dispose() {
      disposed = true
      reading = null
      state.upAll()
    }
  }
}

/**
 * Input changes applied just before one snapshot: presses first, then
 * releases, then the sticks and triggers, which keep their value until set
 * again. `frame` is the snapshot's index, counting from 0 at the first
 * `snapshot()` call. A button both pressed and released in one frame is a
 * tap shorter than a frame.
 */
export interface TimelineEntry {
  readonly frame: number
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
 * that frame is applied. A pad counts as connected from the first entry on.
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
  let analog = { left: zero, right: zero, leftTrigger: 0, rightTrigger: 0 }
  let frame = 0
  return {
    snapshot() {
      for (const entry of byFrame.get(frame) ?? []) {
        for (const button of entry.press ?? []) state.down(button)
        for (const button of entry.release ?? []) state.up(button)
        analog = {
          left: entry.left ?? analog.left,
          right: entry.right ?? analog.right,
          leftTrigger: entry.leftTrigger ?? analog.leftTrigger,
          rightTrigger: entry.rightTrigger ?? analog.rightTrigger
        }
      }
      const connected = frame >= first
      frame += 1
      return state.snapshot({ ...analog, connected, id: connected ? "scripted" : null })
    },
    poll() {},
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

const sameVector = (a: Vector, b: Vector): boolean => a.x === b.x && a.y === b.y

/**
 * Wraps `actions` and records, for every snapshot, the buttons pressed and
 * released since the previous one and the sticks and triggers that moved.
 */
export const recording = <B extends Bindings>(actions: Actions<B>): Recording<B> => {
  const entries: Array<TimelineEntry> = []
  let previous: Pick<Snapshot<B>, "left" | "right" | "leftTrigger" | "rightTrigger"> = { left: zero, right: zero, leftTrigger: 0, rightTrigger: 0 }
  let frame = 0
  return {
    snapshot() {
      const snapshot = actions.snapshot()
      const press = buttonNames.filter((name) => snapshot.buttons[name].pressed)
      const release = buttonNames.filter((name) => snapshot.buttons[name].released)
      const entry: Record<string, unknown> = {
        ...(press.length > 0 ? { press } : {}),
        ...(release.length > 0 ? { release } : {}),
        ...(sameVector(snapshot.left, previous.left) ? {} : { left: snapshot.left }),
        ...(sameVector(snapshot.right, previous.right) ? {} : { right: snapshot.right }),
        ...(snapshot.leftTrigger === previous.leftTrigger ? {} : { leftTrigger: snapshot.leftTrigger }),
        ...(snapshot.rightTrigger === previous.rightTrigger ? {} : { rightTrigger: snapshot.rightTrigger })
      }
      // The first entry also marks when a pad appeared, so a replay connects on the same frame.
      if (Object.keys(entry).length > 0 || (entries.length === 0 && snapshot.connected)) entries.push({ frame, ...entry })
      previous = snapshot
      frame += 1
      return snapshot
    },
    poll: () => actions.poll(),
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
 * of length at most 1, and optional triggers from 0 to 1.
 */
export const parseTimeline = (data: unknown): Result.Result<Timeline, InvalidTimeline> => {
  const invalid = (path: string, message: string) => Result.fail<InvalidTimeline>({ _tag: "InvalidTimeline", path, message })
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
    entries.push(parsed as unknown as TimelineEntry)
  }
  return Result.succeed(entries)
}
