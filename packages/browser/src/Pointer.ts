/**
 * Mouse and pen input over one element: position and button edges. Touches
 * are ignored by default; on-screen touch controls are `Touch`.
 *
 * Games that aim with the mouse read one snapshot per update, like keyboard
 * actions. The module owns the browser plumbing: element-relative
 * coordinates, press/release edges that survive clicks shorter than one
 * frame, pointer capture so a release outside the element is still seen,
 * suppressing the context menu, clearing buttons on window blur, and listener
 * cleanup. It does not know about the ECS; `InputCapture.system(...)` copies
 * snapshots from a service into a resource, directly or through an adapter
 * that merges pointer and keyboard snapshots.
 *
 * Positions are in CSS pixels relative to the element's top-left corner.
 * Converting them into world coordinates (camera, zoom, projection) is game
 * code.
 *
 * @module Pointer
 * @docGroup browser
 *
 * @example
 * ```ts
 * const pointer = Pointer.track(canvas, window)
 *
 * // Once per update:
 * const snapshot = pointer.snapshot()
 * aimAt(snapshot.position)
 * if (snapshot.primary.held) fire()
 *
 * // On teardown:
 * pointer.dispose()
 * ```
 *
 * For tests, replays, and headless runs, `scripted(...)` plays a timeline of
 * moves, presses, and releases, and `recording(...)` wraps a live pointer to
 * capture the timeline a session produced. `parseTimeline(...)` validates a
 * timeline loaded from JSON.
 */
import * as Result from "@typeonce/ritmo/Result"

import type { ActionState } from "./Keyboard.ts"

export type { ActionState }

/** The buttons a snapshot reports, from `PointerEvent.button` 0, 2, and 1. */
export type Button = "primary" | "secondary" | "middle"

const buttons: ReadonlyArray<Button> = ["primary", "secondary", "middle"]

const buttonOf = (code: number): Button | undefined =>
  code === 0 ? "primary" : code === 2 ? "secondary" : code === 1 ? "middle" : undefined

/** A position in CSS pixels relative to the element's top-left corner. */
export interface Position {
  readonly x: number
  readonly y: number
}

export interface Snapshot {
  /** The last position the pointer was seen at, or where it was last left. */
  readonly position: Position
  /** Whether the pointer is currently over the element (or captured by it). */
  readonly over: boolean
  readonly primary: ActionState
  readonly secondary: ActionState
  readonly middle: ActionState
}

export interface Pointer {
  /**
   * Returns the pointer state and starts a new press/release window.
   */
  snapshot(): Snapshot
  /**
   * Removes the event listeners.
   */
  dispose(): void
}

/**
 * The subset of `PointerEvent` the module reads.
 */
export interface PointerEventLike {
  readonly clientX: number
  readonly clientY: number
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
  getBoundingClientRect(): { readonly left: number; readonly top: number }
  setPointerCapture?(pointerId: number): void
  releasePointerCapture?(pointerId: number): void
}

/**
 * Where window blur is observed, usually `window`. Buttons held when the
 * window loses focus are released.
 */
export interface BlurHost {
  addEventListener(type: "blur", listener: () => void): void
  removeEventListener(type: "blur", listener: () => void): void
}

export interface TrackOptions {
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
}

/**
 * A snapshot with no buttons down, for initializing an input resource before
 * the first capture.
 */
export const idle = (position: Position = { x: 0, y: 0 }): Snapshot => ({
  position: { x: position.x, y: position.y },
  over: false,
  primary: { held: false, pressed: false, released: false },
  secondary: { held: false, pressed: false, released: false },
  middle: { held: false, pressed: false, released: false }
})

interface ButtonEdges {
  readonly held: Set<Button>
  readonly pressed: Set<Button>
  readonly released: Set<Button>
}

const makeEdges = (): ButtonEdges => ({ held: new Set(), pressed: new Set(), released: new Set() })

const snapshotOf = (position: Position, over: boolean, edges: ButtonEdges): Snapshot => {
  const state = (button: Button): ActionState => {
    const held = edges.held.has(button)
    return { held, pressed: edges.pressed.has(button), released: edges.released.has(button) && !held }
  }
  return {
    position: { x: position.x, y: position.y },
    over,
    primary: state("primary"),
    secondary: state("secondary"),
    middle: state("middle")
  }
}

/**
 * Starts tracking the pointer over `target`. `blurHost` (usually `window`)
 * releases held buttons when the page loses focus.
 */
export const track = (target: PointerTarget, blurHost: BlurHost, options: TrackOptions = {}): Pointer => {
  const preventContextMenu = options.preventContextMenu ?? true
  const pointerTypes = options.pointerTypes ?? ["mouse", "pen"]
  const tracked = (event: PointerEventLike): boolean => pointerTypes.includes(event.pointerType ?? "mouse")
  const edges = makeEdges()
  let position: Position = { x: 0, y: 0 }
  let over = false

  const locate = (event: PointerEventLike): void => {
    const rect = target.getBoundingClientRect()
    position = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onDown = (event: PointerEventLike): void => {
    if (!tracked(event)) return
    locate(event)
    over = true
    const button = buttonOf(event.button)
    if (button === undefined) return
    event.preventDefault()
    target.setPointerCapture?.(event.pointerId)
    if (edges.held.has(button)) return
    edges.held.add(button)
    edges.pressed.add(button)
  }

  const onUp = (event: PointerEventLike): void => {
    if (!tracked(event)) return
    locate(event)
    const button = buttonOf(event.button)
    if (button === undefined || !edges.held.delete(button)) return
    edges.released.add(button)
    if (edges.held.size === 0) target.releasePointerCapture?.(event.pointerId)
  }

  const onMove = (event: PointerEventLike): void => {
    if (!tracked(event)) return
    locate(event)
    over = true
  }

  const onEnter = (event: PointerEventLike): void => {
    if (!tracked(event)) return
    locate(event)
    over = true
  }

  const onLeave = (event: PointerEventLike): void => {
    if (tracked(event)) over = false
  }

  const releaseAll = (): void => {
    for (const button of edges.held) edges.released.add(button)
    edges.held.clear()
  }

  const onCancel = (event: PointerEventLike): void => {
    if (tracked(event)) releaseAll()
  }

  const onContextMenu = (event: { preventDefault(): void }): void => {
    if (preventContextMenu) event.preventDefault()
  }

  target.addEventListener("pointerdown", onDown)
  target.addEventListener("pointerup", onUp)
  target.addEventListener("pointermove", onMove)
  target.addEventListener("pointerenter", onEnter)
  target.addEventListener("pointerleave", onLeave)
  target.addEventListener("pointercancel", onCancel)
  target.addEventListener("contextmenu", onContextMenu)
  blurHost.addEventListener("blur", releaseAll)

  return {
    snapshot() {
      const snapshot = snapshotOf(position, over, edges)
      edges.pressed.clear()
      edges.released.clear()
      return snapshot
    },
    dispose() {
      target.removeEventListener("pointerdown", onDown)
      target.removeEventListener("pointerup", onUp)
      target.removeEventListener("pointermove", onMove)
      target.removeEventListener("pointerenter", onEnter)
      target.removeEventListener("pointerleave", onLeave)
      target.removeEventListener("pointercancel", onCancel)
      target.removeEventListener("contextmenu", onContextMenu)
      blurHost.removeEventListener("blur", releaseAll)
    }
  }
}

/**
 * Pointer changes applied just before one snapshot: the move first, then
 * presses, then releases. `frame` is the snapshot's index, counting from 0 at
 * the first `snapshot()` call. A button both pressed and released in one frame
 * is a click shorter than a frame.
 */
export interface TimelineEntry {
  readonly frame: number
  readonly move?: Position
  readonly press?: ReadonlyArray<Button>
  readonly release?: ReadonlyArray<Button>
}

/**
 * Pointer changes by snapshot index. Plain data, so it round-trips through
 * JSON; load it back with `parseTimeline`.
 */
export type Timeline = ReadonlyArray<TimelineEntry>

/**
 * A pointer driven by a timeline instead of an element.
 */
export interface Scripted extends Pointer {
  /** Number of snapshots taken so far, which is the next frame index. */
  readonly frames: () => number
}

/**
 * Plays `timeline`: before the snapshot at index `frame`, every entry for that
 * frame is applied. Buttons stay held from their press until their release.
 * The scripted pointer is always over the element.
 */
export const scripted = (timeline: Timeline, start: Position = { x: 0, y: 0 }): Scripted => {
  const byFrame = new Map<number, Array<TimelineEntry>>()
  for (const entry of timeline) {
    const entries = byFrame.get(entry.frame)
    if (entries) entries.push(entry)
    else byFrame.set(entry.frame, [entry])
  }
  const edges = makeEdges()
  let position = start
  let frame = 0
  return {
    snapshot() {
      edges.pressed.clear()
      edges.released.clear()
      for (const entry of byFrame.get(frame) ?? []) {
        if (entry.move !== undefined) position = entry.move
        for (const button of entry.press ?? []) {
          edges.held.add(button)
          edges.pressed.add(button)
        }
        for (const button of entry.release ?? []) {
          if (edges.held.delete(button)) edges.released.add(button)
        }
      }
      frame += 1
      return snapshotOf(position, true, edges)
    },
    dispose() {},
    frames: () => frame
  }
}

/**
 * A live pointer that also records the timeline it produces.
 */
export interface Recording extends Pointer {
  /** The recorded timeline; `scripted(timeline)` replays the same positions and buttons. */
  readonly timeline: () => Timeline
}

/**
 * Wraps `pointer` and records, for every snapshot, the position when it moved
 * and the buttons pressed and released since the previous one.
 */
export const recording = (pointer: Pointer): Recording => {
  const entries: Array<TimelineEntry> = []
  let frame = 0
  let last: Position | undefined
  return {
    snapshot() {
      const snapshot = pointer.snapshot()
      const moved = last === undefined || last.x !== snapshot.position.x || last.y !== snapshot.position.y
      last = snapshot.position
      const press = buttons.filter((button) => snapshot[button].pressed)
      const release = buttons.filter((button) => snapshot[button].released)
      if (moved || press.length > 0 || release.length > 0) {
        entries.push({
          frame,
          ...(moved ? { move: snapshot.position } : {}),
          ...(press.length > 0 ? { press } : {}),
          ...(release.length > 0 ? { release } : {})
        })
      }
      frame += 1
      return snapshot
    },
    dispose() {
      pointer.dispose()
    },
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
 * timeline: an array of entries with a non-negative integer `frame`, an
 * optional finite `move`, and optional `press`/`release` arrays of buttons.
 */
export const parseTimeline = (data: unknown): Result.Result<Timeline, InvalidTimeline> => {
  const invalid = (path: string, message: string) => Result.fail<InvalidTimeline>({ _tag: "InvalidTimeline", path, message })
  if (!Array.isArray(data)) return invalid("", "expected an array of entries")
  const entries: Array<TimelineEntry> = []
  for (let index = 0; index < data.length; index++) {
    const entry: unknown = data[index]
    const path = `[${index}]`
    if (typeof entry !== "object" || entry === null) return invalid(path, "expected an object")
    const { frame, move, press, release } = entry as {
      readonly frame?: unknown
      readonly move?: unknown
      readonly press?: unknown
      readonly release?: unknown
    }
    if (typeof frame !== "number" || !Number.isInteger(frame) || frame < 0) {
      return invalid(`${path}.frame`, "expected a non-negative integer")
    }
    let position: Position | undefined
    if (move !== undefined) {
      if (typeof move !== "object" || move === null) return invalid(`${path}.move`, "expected an object with x and y")
      const { x, y } = move as { readonly x?: unknown; readonly y?: unknown }
      if (typeof x !== "number" || !Number.isFinite(x)) return invalid(`${path}.move.x`, "expected a finite number")
      if (typeof y !== "number" || !Number.isFinite(y)) return invalid(`${path}.move.y`, "expected a finite number")
      position = { x, y }
    }
    const buttonsAt = (value: unknown, field: string): Result.Result<Array<Button> | undefined, InvalidTimeline> => {
      if (value === undefined) return Result.succeed(undefined)
      if (!Array.isArray(value)) return invalid(`${path}.${field}`, "expected an array of buttons")
      const names: Array<Button> = []
      for (let offset = 0; offset < value.length; offset++) {
        const name: unknown = value[offset]
        const button = buttons.find((candidate) => candidate === name)
        if (button === undefined) return invalid(`${path}.${field}[${offset}]`, `expected one of ${buttons.join(", ")}`)
        names.push(button)
      }
      return Result.succeed(names)
    }
    const pressed = buttonsAt(press, "press")
    if (pressed._tag === "Failure") return pressed
    const released = buttonsAt(release, "release")
    if (released._tag === "Failure") return released
    entries.push({
      frame,
      ...(position === undefined ? {} : { move: position }),
      ...(pressed.success === undefined ? {} : { press: pressed.success }),
      ...(released.success === undefined ? {} : { release: released.success })
    })
  }
  return Result.succeed(entries)
}
