/**
 * Mouse and pen input over one element: bound actions, raw buttons, and the
 * position. Touches are ignored by default; on-screen touch controls are
 * `Touch`.
 *
 * `Pointer.actions(target, window, bindings)` binds game actions to
 * buttons, like `Keyboard.actions` and `Gamepad.actions`, so the pointer
 * merges into `Controls` (group it with the keyboard there, so the two count
 * as one device for `lastUsed` and `available`). Games that aim with the
 * mouse read `position`. The module owns the browser plumbing:
 * element-relative coordinates, press/release edges that survive clicks
 * shorter than one frame, pointer capture so a release outside the element
 * is still seen, suppressing the context menu, clearing buttons on window
 * blur, and listener cleanup. It does not know about the ECS;
 * `InputCapture.system(...)` copies snapshots into a resource.
 *
 * Positions are in CSS pixels relative to the element's top-left corner.
 * Converting them into world coordinates (camera, zoom, projection) is game
 * code. `rebind(...)` swaps the buttons of the same actions, and
 * `parseRebinding(...)` validates saved ones.
 *
 * The wheel reports both ways games use it: `wheel` is how far it scrolled
 * (zoom), and the `wheelUp`/`wheelDown`/`wheelLeft`/`wheelRight` buttons
 * pulse once per notch, so a stepping action (next weapon) binds them and
 * merges with a gamepad bumper. For mouse look, pass `lock: document`: a
 * click locks the pointer to the element, `movement` keeps reporting raw
 * motion, and `locked` turns `false` when the player presses Escape.
 *
 * @module Pointer
 * @docGroup browser
 *
 * @example
 * ```ts
 * declare const canvas: HTMLCanvasElement
 * declare const aimAt: (position: Pointer.Position) => void
 * declare const fire: () => void
 * declare const zoomBy: (steps: number) => void
 * declare const turn: (by: number) => void
 * // ---cut---
 * const bindings = { fire: ["primary"], aim: ["secondary"], nextWeapon: ["wheelDown"] } as const
 * const mouse = Pointer.actions(canvas, window, bindings, { lock: document })
 *
 * // Once per update (through InputCapture in a game):
 * const input = mouse.snapshot()
 * aimAt(input.position)
 * if (input.actions.fire.pressed) fire()
 *
 * // Zoom with the wheel, look with a locked pointer:
 * zoomBy(input.wheel.y)
 * if (input.locked) turn(input.movement.x)
 *
 * // Settings screen: bind the button the player clicks.
 * const clicked = Pointer.buttonNames.find((button) => input.buttons[button].pressed)
 * if (clicked !== undefined) mouse.rebind({ fire: [clicked], aim: ["secondary"], nextWeapon: ["wheelDown"] })
 *
 * // On teardown:
 * mouse.dispose()
 * ```
 *
 * For tests, replays, and headless runs, `scripted(bindings, timeline)`
 * plays a timeline of moves, presses, and releases, and `recording(...)`
 * wraps a live pointer to capture the timeline a session produced.
 * `parseTimeline(...)` validates a timeline loaded from JSON.
 */
import type * as System from "@typeonce/ritmo/System"
import * as Result from "@typeonce/ritmo/Result"

import type { ActionState } from "./internal/state.ts"
import * as ButtonsInternal from "./internal/buttons.ts"
import { buttonTracker, idleActions, idleButtons } from "./internal/buttons.ts"
import { anyUsed } from "./internal/used.ts"

/** The physical buttons, in `PointerEvent.button` order 0 to 4. */
const physicalButtons = ["primary", "middle", "secondary", "back", "forward"] as const

/** A button that goes down and up, unlike the wheel's pulses: what a timeline presses and releases. */
export type PhysicalButton = (typeof physicalButtons)[number]

const isPhysical = (name: unknown): name is PhysicalButton => (physicalButtons as ReadonlyArray<unknown>).includes(name)

/**
 * The buttons a snapshot reports: the main (usually left) button, the wheel
 * button, the secondary (usually right) button, the side buttons, then the
 * wheel's four directions. A wheel direction is a pulse, pressed and
 * released in the same window, once per {@link wheelStep} pixels scrolled,
 * so it binds actions that step (next weapon) and merges with a gamepad
 * bumper in `Controls`; read the snapshot's `wheel` for how far it scrolled
 * (zoom).
 */
export const buttonNames = [...physicalButtons, "wheelUp", "wheelDown", "wheelLeft", "wheelRight"] as const

/** One pointer button, see {@link buttonNames}. */
export type Button = (typeof buttonNames)[number]

/** Pixels scrolled per wheel pulse: one notch of a typical mouse wheel. */
export const wheelStep = 100

const buttonOf = (code: number): Button | undefined => physicalButtons[code]

const buttonSet: ReadonlySet<string> = new Set(buttonNames)

/** Whether `name` is a pointer button, for validating stored bindings. */
export const isButton = (name: unknown): name is Button => typeof name === "string" && buttonSet.has(name)

/**
 * Action name to the buttons that trigger it. Every action needs at least
 * one button; `{}` tracks the position and raw buttons only.
 */
export type Bindings = Readonly<Record<string, readonly [Button, ...Array<Button>]>>

/**
 * New buttons for the same actions, for {@link Actions.rebind}. Load saved
 * ones with {@link parseRebinding}.
 */
export type Rebinding<B extends Bindings> = { readonly [Action in keyof B]: readonly [Button, ...Array<Button>] }

/**
 * Rejects actions a rebinding names that the bindings do not have, so
 * {@link Actions.rebind} takes exactly the actions it was made with.
 */
export type OnlyActionsOf<R, B extends Bindings> = {
  readonly [Name in Exclude<keyof R, keyof B>]: `${Name & string} is not an action of these bindings`
}

/** A position in CSS pixels relative to the element's top-left corner. */
export interface Position {
  readonly x: number
  readonly y: number
}

/** A change in CSS pixels since the previous snapshot. */
export interface Delta {
  readonly x: number
  readonly y: number
}

/**
 * The pointer's state, with the same core as the other devices' snapshots
 * (`actions`, `vectors`, and `used`) so `Controls` can merge it.
 */
export interface Snapshot<B extends Bindings> {
  /** Every bound action's state. */
  readonly actions: { readonly [Action in keyof B]: ActionState }
  /** None: a pointer binds no vector actions (read `position` and `movement`); there for the snapshot core every device shares. */
  readonly vectors: { readonly [Action in never]: Delta }
  /** Every button's state by name, whatever the bindings (capture the button to bind from here). */
  readonly buttons: { readonly [Name in Button]: ActionState }
  /** The last position the pointer was seen at, or where it was last left. */
  readonly position: Position
  /**
   * How far the pointer moved since the previous snapshot, from the raw
   * motion (`movementX`/`movementY`), which keeps coming while the pointer is
   * locked and the position stands still: read it for mouse look.
   */
  readonly movement: Delta
  /** How far the wheel scrolled since the previous snapshot, in CSS pixels (positive `y` scrolls down). */
  readonly wheel: Delta
  /** Whether the pointer is currently over the element (or captured by it). */
  readonly over: boolean
  /**
   * Whether the pointer is locked to the element (with the `lock` option).
   * The player leaves the lock with Escape; show "click to resume" while it
   * is `false`.
   */
  readonly locked: boolean
  /**
   * Some button was pressed in this window or is held, or the pointer moved
   * or scrolled over the element: the player is using the pointer.
   */
  readonly used: boolean
}

/**
 * A pointer bound to actions, built with {@link actions} (live),
 * {@link scripted}, or {@link recording}. Capture it with
 * `InputCapture.system(...)`, or group it with the keyboard in `Controls`.
 *
 * In a test, build one with {@link scripted} rather than writing the object
 * by hand: a hand-written double must also implement `rebind` and `dispose`.
 */
export interface Actions<B extends Bindings> extends System.Consumes<"snapshot"> {
  /** Returns the pointer state and starts a new press/release window. */
  snapshot(): Snapshot<B>
  /**
   * Binds the same actions to new buttons, from the next snapshot, for a
   * settings screen where players remap controls (capture the button to bind
   * from the snapshot's `buttons`). An action held only through buttons it
   * lost reports `released`; a button held across the rebind holds a newly
   * bound action only once it is pressed again. It takes exactly the actions
   * the pointer was made with.
   */
  rebind<const R extends Rebinding<B>>(bindings: R & OnlyActionsOf<R, B>): void
  /** Removes the event listeners. */
  dispose(): void
}

/**
 * The subset of `PointerEvent` the module reads.
 */
export interface PointerEventLike {
  readonly clientX: number
  readonly clientY: number
  /** Raw motion since the previous event; events without it count as 0. */
  readonly movementX?: number
  readonly movementY?: number
  readonly button: number
  readonly pointerId: number
  /** `"mouse"`, `"pen"`, or `"touch"`; events without it count as mouse. */
  readonly pointerType?: string
  preventDefault(): void
}

/**
 * The element the pointer is tracked over, usually the game canvas.
 */
export interface PointerTarget {
  addEventListener(
    type: "pointerdown" | "pointerup" | "pointermove" | "pointerenter" | "pointerleave" | "pointercancel",
    listener: (event: PointerEventLike) => void
  ): void
  addEventListener(type: "contextmenu", listener: (event: { preventDefault(): void }) => void): void
  removeEventListener(
    type: "pointerdown" | "pointerup" | "pointermove" | "pointerenter" | "pointerleave" | "pointercancel",
    listener: (event: PointerEventLike) => void
  ): void
  removeEventListener(type: "contextmenu", listener: (event: { preventDefault(): void }) => void): void
  addEventListener(type: "wheel", listener: (event: WheelEventLike) => void, options: { readonly passive: false }): void
  removeEventListener(type: "wheel", listener: (event: WheelEventLike) => void): void
  getBoundingClientRect(): { readonly left: number; readonly top: number }
  setPointerCapture?(pointerId: number): void
  releasePointerCapture?(pointerId: number): void
  /** Called on a click with the `lock` option while the pointer is not locked. */
  requestPointerLock?(): unknown
}

/** The subset of `WheelEvent` the module reads. */
export interface WheelEventLike {
  readonly deltaX: number
  readonly deltaY: number
  /** 0 for pixels, 1 for lines (16 px each), 2 for pages (800 px each). */
  readonly deltaMode: number
  preventDefault(): void
}

/**
 * Where the pointer lock is observed, usually `document`, for the `lock`
 * option.
 */
export interface LockHost {
  readonly pointerLockElement: unknown
  addEventListener(type: "pointerlockchange", listener: () => void): void
  removeEventListener(type: "pointerlockchange", listener: () => void): void
}

/**
 * Where window blur is observed, usually `window`. Buttons held when the
 * window loses focus are released.
 */
export interface BlurHost {
  addEventListener(type: "blur", listener: () => void): void
  removeEventListener(type: "blur", listener: () => void): void
}

/** Options for {@link actions}. */
export interface ActionsOptions {
  /**
   * Suppress the context menu over the element, so the secondary button is
   * usable. Defaults to `true`.
   */
  readonly preventContextMenu?: boolean
  /**
   * `PointerEvent.pointerType`s tracked. Defaults to `["mouse", "pen"]`:
   * touches are left to `Touch`, so a finger on an on-screen control is not
   * also a click.
   */
  readonly pointerTypes?: ReadonlyArray<string>
  /**
   * Keep the page from scrolling while the wheel turns over the element.
   * Defaults to `true`.
   */
  readonly preventScroll?: boolean
  /**
   * Lock the pointer to the element on a click, for mouse look: pass where
   * the lock is observed (usually `document`). Browsers grant a lock only
   * inside a click, so the module requests it in its own listener; the
   * click that locks is not reported as a press. Read `locked` and
   * `movement`.
   */
  readonly lock?: LockHost
}

/**
 * A snapshot with no buttons down and no use yet, for initializing an input
 * resource before the first capture.
 */
export const idle = <const B extends Bindings>(bindings: B, position: Position = { x: 0, y: 0 }): Snapshot<B> => ({
  actions: idleActions(bindings),
  vectors: {},
  buttons: idleButtons(buttonNames),
  position: { x: position.x, y: position.y },
  movement: { x: 0, y: 0 },
  wheel: { x: 0, y: 0 },
  over: false,
  locked: false,
  used: false
})

const pixelsPer = [1, 16, 800]

/**
 * The button tracker with the position, motion, and wheel, shared by live
 * and scripted pointers.
 */
const tracker = <B extends Bindings>(initial: B, start: Position) => {
  const buttons = buttonTracker(buttonNames, initial)
  let position = start
  let moved = false
  let movement = { x: 0, y: 0 }
  let wheel = { x: 0, y: 0 }
  // Scrolled toward the next pulse, per axis; reset when the direction turns.
  const pending = { x: 0, y: 0 }
  const pulse = (button: Button): void => {
    buttons.down(button)
    buttons.up(button)
  }
  const step = (axis: "x" | "y", delta: number, negative: Button, positive: Button): void => {
    if (delta === 0) return
    if (Math.sign(pending[axis]) !== Math.sign(delta)) pending[axis] = 0
    pending[axis] += delta
    while (Math.abs(pending[axis]) >= wheelStep) {
      pulse(pending[axis] < 0 ? negative : positive)
      pending[axis] -= Math.sign(pending[axis]) * wheelStep
    }
  }
  return {
    buttons,
    move(next: Position) {
      if (next.x === position.x && next.y === position.y) return
      position = next
      moved = true
    },
    motion(delta: Delta) {
      movement = { x: movement.x + delta.x, y: movement.y + delta.y }
    },
    scroll(delta: Delta) {
      wheel = { x: wheel.x + delta.x, y: wheel.y + delta.y }
      step("y", delta.y, "wheelUp", "wheelDown")
      step("x", delta.x, "wheelLeft", "wheelRight")
    },
    snapshot(over: boolean, locked: boolean): Snapshot<B> {
      const taken = buttons.take()
      const used = moved || movement.x !== 0 || movement.y !== 0 || wheel.x !== 0 || wheel.y !== 0 || anyUsed(taken.buttons)
      const snapshot = { ...taken, vectors: {}, position: { x: position.x, y: position.y }, movement, wheel, over, locked, used }
      moved = false
      movement = { x: 0, y: 0 }
      wheel = { x: 0, y: 0 }
      return snapshot
    }
  }
}

/**
 * Starts tracking the pointer over `target` with `bindings`, until
 * `dispose()`. `blurHost` (usually `window`) releases held buttons when the
 * page loses focus; a cancelled pointer and leaving the pointer lock release
 * them too. Use `Touch.actions` for on-screen touch controls.
 */
export const actions = <const B extends Bindings>(
  target: PointerTarget,
  blurHost: BlurHost,
  bindings: B,
  options: ActionsOptions = {}
): Actions<B> => {
  const preventContextMenu = options.preventContextMenu ?? true
  const preventScroll = options.preventScroll ?? true
  const lock = options.lock
  const pointerTypes = options.pointerTypes ?? ["mouse", "pen"]
  const tracked = (event: PointerEventLike): boolean => pointerTypes.includes(event.pointerType ?? "mouse")
  const state = tracker(bindings, { x: 0, y: 0 })
  let over = false
  const isLocked = (): boolean => lock !== undefined && lock.pointerLockElement === target

  const locate = (event: PointerEventLike): void => {
    const rect = target.getBoundingClientRect()
    state.move({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    state.motion({ x: event.movementX ?? 0, y: event.movementY ?? 0 })
  }

  const onDown = (event: PointerEventLike): void => {
    if (!tracked(event)) return
    locate(event)
    over = true
    const button = buttonOf(event.button)
    if (button === undefined) return
    event.preventDefault()
    if (lock !== undefined && !isLocked()) {
      // The click that locks is not a press: "click to resume" does not also fire.
      target.requestPointerLock?.()
      return
    }
    target.setPointerCapture?.(event.pointerId)
    state.buttons.down(button)
  }

  const onUp = (event: PointerEventLike): void => {
    if (!tracked(event)) return
    locate(event)
    const button = buttonOf(event.button)
    if (button === undefined || !state.buttons.held.has(button)) return
    state.buttons.up(button)
    if (state.buttons.held.size === 0) target.releasePointerCapture?.(event.pointerId)
  }

  const onMove = (event: PointerEventLike): void => {
    if (!tracked(event)) return
    locate(event)
    over = true
  }

  const onLeave = (event: PointerEventLike): void => {
    if (tracked(event)) over = false
  }

  const onCancel = (event: PointerEventLike): void => {
    if (tracked(event)) state.buttons.upAll()
  }

  const onContextMenu = (event: { preventDefault(): void }): void => {
    if (preventContextMenu) event.preventDefault()
  }

  const onWheel = (event: WheelEventLike): void => {
    if (preventScroll) event.preventDefault()
    const scale = pixelsPer[event.deltaMode] ?? 1
    state.scroll({ x: event.deltaX * scale, y: event.deltaY * scale })
  }

  // Leaving the lock (Escape) releases what was held, like a blur.
  const onLockChange = (): void => {
    if (!isLocked()) state.buttons.upAll()
  }

  target.addEventListener("pointerdown", onDown)
  target.addEventListener("pointerup", onUp)
  target.addEventListener("pointermove", onMove)
  target.addEventListener("pointerenter", onMove)
  target.addEventListener("pointerleave", onLeave)
  target.addEventListener("pointercancel", onCancel)
  target.addEventListener("contextmenu", onContextMenu)
  target.addEventListener("wheel", onWheel, { passive: false })
  blurHost.addEventListener("blur", state.buttons.upAll)
  lock?.addEventListener("pointerlockchange", onLockChange)

  return {
    snapshot: () => {
      const locked = isLocked()
      return state.snapshot(over || locked, locked)
    },
    rebind: state.buttons.rebind,
    dispose() {
      target.removeEventListener("pointerdown", onDown)
      target.removeEventListener("pointerup", onUp)
      target.removeEventListener("pointermove", onMove)
      target.removeEventListener("pointerenter", onMove)
      target.removeEventListener("pointerleave", onLeave)
      target.removeEventListener("pointercancel", onCancel)
      target.removeEventListener("contextmenu", onContextMenu)
      target.removeEventListener("wheel", onWheel)
      blurHost.removeEventListener("blur", state.buttons.upAll)
      lock?.removeEventListener("pointerlockchange", onLockChange)
    }
  }
}

/**
 * Pointer changes applied just before one snapshot: the move, the raw
 * motion, and the wheel first, then presses, then releases. `frame` is the
 * snapshot's index, counting from 0 at the first `snapshot()` call. A button
 * both pressed and released in one frame is a click shorter than a frame.
 * Wheel pulses come from `wheel`, not from `press`.
 */
export interface TimelineEntry {
  readonly frame: number
  readonly move?: Position
  readonly movement?: Delta
  readonly wheel?: Delta
  /** Locks or unlocks the pointer from this frame on; unlocking releases what was held. */
  readonly locked?: boolean
  readonly press?: ReadonlyArray<PhysicalButton>
  readonly release?: ReadonlyArray<PhysicalButton>
}

/**
 * Pointer changes by snapshot index. Plain data, so it round-trips through
 * JSON; load it back with `parseTimeline`. It names buttons, not actions, so
 * a replay follows the bindings as live play does.
 */
export type Timeline = ReadonlyArray<TimelineEntry>

/** A pointer driven by a timeline instead of an element. */
export interface Scripted<B extends Bindings> extends Actions<B> {
  /** Number of snapshots taken so far, which is the next frame index. */
  readonly frames: () => number
}

/**
 * Plays `timeline` with `bindings`: before the snapshot at index `frame`,
 * every entry for that frame is applied. Buttons stay held from their press
 * until their release. The scripted pointer is always over the element.
 */
export const scripted = <const B extends Bindings>(bindings: B, timeline: Timeline, start: Position = { x: 0, y: 0 }): Scripted<B> => {
  const byFrame = new Map<number, Array<TimelineEntry>>()
  for (const entry of timeline) {
    const entries = byFrame.get(entry.frame)
    if (entries) entries.push(entry)
    else byFrame.set(entry.frame, [entry])
  }
  const state = tracker(bindings, start)
  let frame = 0
  let locked = false
  return {
    snapshot() {
      for (const entry of byFrame.get(frame) ?? []) {
        if (entry.move !== undefined) state.move(entry.move)
        if (entry.movement !== undefined) state.motion(entry.movement)
        if (entry.wheel !== undefined) state.scroll(entry.wheel)
        if (entry.locked !== undefined) {
          if (locked && !entry.locked) state.buttons.upAll()
          locked = entry.locked
        }
        for (const button of entry.press ?? []) state.buttons.down(button)
        for (const button of entry.release ?? []) state.buttons.up(button)
      }
      frame += 1
      return state.snapshot(true, locked)
    },
    rebind: state.buttons.rebind,
    dispose() {},
    frames: () => frame
  }
}

/** A live pointer that also records the timeline it produces. */
export interface Recording<B extends Bindings> extends Actions<B> {
  /** The recorded timeline; `scripted(bindings, timeline)` replays the same positions and buttons. */
  readonly timeline: () => Timeline
}

/**
 * Wraps `pointer` and records, for every snapshot, the position when it moved
 * and the buttons pressed and released since the previous one.
 */
export const recording = <B extends Bindings>(pointer: Actions<B>): Recording<B> => {
  const entries: Array<TimelineEntry> = []
  let frame = 0
  let last: Position | undefined
  let locked = false
  const nonZero = (delta: Delta): boolean => delta.x !== 0 || delta.y !== 0
  return {
    snapshot() {
      const snapshot = pointer.snapshot()
      const moved = last === undefined || last.x !== snapshot.position.x || last.y !== snapshot.position.y
      last = snapshot.position
      // Wheel pulses replay from the recorded wheel.
      const press = physicalButtons.filter((button) => snapshot.buttons[button].pressed)
      const release = physicalButtons.filter((button) => snapshot.buttons[button].released)
      const lockChanged = snapshot.locked !== locked
      locked = snapshot.locked
      if (moved || lockChanged || nonZero(snapshot.movement) || nonZero(snapshot.wheel) || press.length > 0 || release.length > 0) {
        entries.push({
          frame,
          ...(moved ? { move: snapshot.position } : {}),
          ...(nonZero(snapshot.movement) ? { movement: snapshot.movement } : {}),
          ...(nonZero(snapshot.wheel) ? { wheel: snapshot.wheel } : {}),
          ...(lockChanged ? { locked: snapshot.locked } : {}),
          ...(press.length > 0 ? { press } : {}),
          ...(release.length > 0 ? { release } : {})
        })
      }
      frame += 1
      return snapshot
    },
    rebind: (bindings) => pointer.rebind(bindings),
    dispose: () => pointer.dispose(),
    timeline: () => [...entries]
  }
}

/**
 * Why loaded data is not a pointer timeline. `path` points at the offending
 * value, for example `[3].move.x`.
 */
export interface InvalidTimeline {
  readonly _tag: "InvalidTimeline"
  readonly path: string
  readonly message: string
}

/**
 * Validates untrusted data, such as a parsed JSON file, as a pointer
 * timeline: an array of entries with a non-negative integer `frame`,
 * optional finite `move`, `movement`, and `wheel`, an optional boolean
 * `locked`, and optional `press`/`release` arrays of physical buttons.
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
    if (typeof frame !== "number" || !Number.isInteger(frame) || frame < 0) {
      return invalid(`${path}.frame`, "expected a non-negative integer")
    }
    const parsed: Record<string, unknown> = { frame }
    for (const field of ["move", "movement", "wheel"] as const) {
      const value = fields[field]
      if (value === undefined) continue
      if (typeof value !== "object" || value === null) return invalid(`${path}.${field}`, "expected an object with x and y")
      const { x, y } = value as { readonly x?: unknown; readonly y?: unknown }
      if (typeof x !== "number" || !Number.isFinite(x)) return invalid(`${path}.${field}.x`, "expected a finite number")
      if (typeof y !== "number" || !Number.isFinite(y)) return invalid(`${path}.${field}.y`, "expected a finite number")
      parsed[field] = { x, y }
    }
    const locked = fields["locked"]
    if (locked !== undefined) {
      if (typeof locked !== "boolean") return invalid(`${path}.locked`, "expected a boolean")
      parsed["locked"] = locked
    }
    for (const field of ["press", "release"] as const) {
      const value = fields[field]
      if (value === undefined) continue
      if (!Array.isArray(value)) return invalid(`${path}.${field}`, "expected an array of buttons")
      for (let offset = 0; offset < value.length; offset++) {
        if (!isPhysical(value[offset])) return invalid(`${path}.${field}[${offset}]`, `expected one of ${physicalButtons.join(", ")}`)
      }
      parsed[field] = [...value]
    }
    entries.push(parsed as unknown as TimelineEntry)
  }
  return Result.success(entries)
}

/**
 * Why loaded data is not a rebinding for the bindings. `path` points at the
 * offending value, for example `fire[1]`.
 */
export type InvalidRebinding = ButtonsInternal.InvalidRebinding

/**
 * Validates untrusted data, such as saved settings parsed from JSON, as new
 * buttons for `bindings`: an object with exactly the same action names, each
 * mapped to a non-empty array of button names. Pass the result to
 * {@link Actions.rebind}; on failure, keep the defaults.
 *
 * @example
 * ```ts
 * declare const canvas: HTMLCanvasElement
 * const bindings = { fire: ["primary"], aim: ["secondary"] } as const
 * const mouse = Pointer.actions(canvas, window, bindings)
 * declare const stored: string
 * // ---cut---
 * const saved = Pointer.parseRebinding(bindings, JSON.parse(stored))
 * if (saved.ok) mouse.rebind(saved.value)
 * ```
 */
export const parseRebinding = <const B extends Bindings>(
  bindings: B,
  data: unknown
): Result.Result<Rebinding<B>, InvalidRebinding> =>
  // The checked names and buttons are exactly `Rebinding<B>`.
  ButtonsInternal.parseButtonRebinding(buttonNames, bindings, data) as Result.Result<Rebinding<B>, InvalidRebinding>
