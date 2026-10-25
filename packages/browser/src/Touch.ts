/**
 * Touch controls over one element: named floating sticks, buttons (some of
 * which aim by dragging: tap to use, drag to aim, release to fire), and an
 * optional swipe area that reports how far a finger moved, for turning or
 * camera control (Genshin Impact style: move on the left, swipe anywhere to
 * look).
 *
 * A stick's key is the vector it drives and a button's key is the action it
 * reports, so a twin-stick shooter declares `move` and `aim` sticks and
 * reads `vectors.move` and `vectors.aim`. Use a stick for a direction the
 * player holds and changes continuously (walking, aiming a stream of shots);
 * use a button with `aimRadius` for a direction picked once per use (aim a
 * throw, release to fire), which reports the aim on the release.
 *
 * The layout is a function of the element's size, so controls stay anchored
 * to corners on any screen. Each finger belongs to the first control it lands
 * on: a button when it lands inside one, otherwise the first free stick (in
 * the layout's key order) whose region contains it (the stick then appears
 * under the thumb), otherwise the swipe area when it lands in its region.
 * Fingers that land elsewhere are ignored, and a control keeps its finger
 * until it lifts, so two thumbs drive two sticks at once.
 *
 * A control the game hides (a stick for walking while the player drives) is
 * `null` in the layout. The layout is read again on every snapshot and every
 * new touch, so a control turning `null` under a held finger releases at
 * once, as a cancel, and that finger does nothing until it lifts: a thumb
 * resting on the walking stick does not keep walking a car.
 *
 * Games read one snapshot per update, like keyboard actions: each stick's
 * vector, and per button `held`/`pressed`/`released` edges that survive taps
 * shorter than a frame, plus the drag `aim`, which is still reported on the
 * release. A touch the browser cancels (a system gesture, the window losing
 * focus) releases with `cancelled: true`, so games can skip firing. `view()`
 * returns the live positions for drawing the controls without consuming edges.
 *
 * Only `touch` pointers are tracked by default, so a mouse keeps working
 * through `Pointer`; pass `pointerTypes` to also drive the controls with a
 * mouse while developing. The module sets `touch-action: none` on the element
 * so the browser does not scroll or zoom under the controls.
 *
 * @module Touch
 * @docGroup browser
 *
 * @example
 * ```ts
 * declare const canvas: HTMLCanvasElement
 * declare const move: (direction: Touch.StickState) => void
 * declare const shoot: (direction: Touch.StickState) => void
 * declare const dash: () => void
 * // ---cut---
 * const touch = Touch.actions(canvas, window, ({ width, height }) => ({
 *   // Each stick drives the vector named like its key, so it merges into `Controls`.
 *   sticks: {
 *     move: { region: { left: 0, top: 0, width: width / 2, height }, radius: 56 },
 *     aim: { region: { left: width / 2, top: 0, width: width / 2, height }, radius: 56 }
 *   },
 *   buttons: { dash: { center: { x: width - 84, y: height - 150 }, radius: 36 } }
 * }))
 *
 * // Once per update:
 * const { vectors, actions } = touch.snapshot()
 * move(vectors.move)
 * if (vectors.aim.active) shoot(vectors.aim)
 * if (actions.dash.pressed) dash()
 * ```
 *
 * For tests and headless runs, `scripted(...)` plays a timeline of stick
 * vectors, presses, drags, and releases.
 */
import type * as System from "@typeonce/ritmo/System"
import { anyUsed } from "./internal/used.ts"
import type { ActionState } from "./internal/state.ts"
import type { Vector } from "./internal/vectors.ts"

/** A position in CSS pixels relative to the element's top-left corner. */
export interface Position {
  readonly x: number
  readonly y: number
}

/** A rectangle in CSS pixels relative to the element's top-left corner. */
export interface Rect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** One floating stick of a {@link Layout}; it drives the vector named like its key in `sticks`. */
export interface StickZone {
  /** Where a touch starts the stick. The stick is centered where the thumb lands. */
  readonly region: Rect
  /** Drag distance in CSS pixels for full tilt. */
  readonly radius: number
  /** Fraction of `radius` that reads as zero. Defaults to 0.15. */
  readonly deadZone?: number
  /** Not a setting: a stick drives the vector named by its key in `Layout.sticks`. */
  readonly vector?: "a stick drives the vector named by its key in sticks: remove vector"
}

/**
 * The zone of the stick named `K` in a {@link Layout}: a {@link StickZone}
 * (`null` while the stick is hidden), or an error naming the cause when a
 * button has the same name (a name is either a vector a stick drives or an
 * action a button reports).
 */
export type StickNamed<K extends string, B extends string, H extends string = K> = K extends B
  ? `${K} names both a stick and a button: give them different names`
  : K extends H ? StickZone | null : StickZone

/** A round on-screen button of a {@link Layout}; it reports the action named like its key. */
export interface ButtonZone {
  readonly center: Position
  /** Touch radius in CSS pixels. */
  readonly radius: number
  /** Drag distance in CSS pixels for a full-length aim. Without it the button does not aim. */
  readonly aimRadius?: number
  /** Fraction of `aimRadius` that counts as a tap (no aim). Defaults to 0.2. */
  readonly aimDeadZone?: number
}

/** The swipe area of a {@link Layout}. */
export interface SwipeZone {
  /** Where a touch that is not on a button or a stick starts a swipe. */
  readonly region: Rect
}

/**
 * The touch controls, returned by the layout function {@link actions} calls
 * with the element's size. The stick and button names are fixed by the
 * first layout; a control the game hides keeps its name with a `null` zone.
 * `H` names the controls whose zone may be `null`: `actions` infers it from
 * the layout function, so a control it never hides has a zone that is never
 * `null` in `view().layout`.
 */
export interface Layout<B extends string, V extends string = never, H extends B | V = B | V> {
  /**
   * The floating sticks, each keyed by the vector it drives (`move`, `aim`);
   * `{}` for buttons only. A finger that is not on a button goes to the
   * first stick, in key order, that is free and whose region contains it,
   * so where regions overlap the earlier key wins. `null` hides a stick:
   * it takes no finger and reports a resting vector.
   */
  readonly sticks: { readonly [K in V]: StickNamed<K, B, H> }
  /**
   * The buttons, each keyed by the action it reports. `null` hides a
   * button: it takes no finger and reports nothing held.
   */
  readonly buttons: { readonly [K in B]: K extends H ? ButtonZone | null : ButtonZone }
  /** Optional: fingers here report their movement, for turning or looking around. */
  readonly swipe?: SwipeZone
}

// The keys of a zone record whose value may be `null`.
type NullableKeys<Zones> = { [K in keyof Zones]-?: null extends Zones[K] ? K : never }[keyof Zones]

/** The controls a layout function can hide: the names whose zone it may return as `null`. */
export type Hideable<L> = L extends { readonly sticks: infer S; readonly buttons: infer Bs }
  ? Extract<NullableKeys<S> | NullableKeys<Bs>, string>
  : never

/** The element's size in CSS pixels, passed to the layout function. */
export interface Size {
  readonly width: number
  readonly height: number
}

/**
 * One stick's state: its vector (tilt with the dead zone removed, zero at
 * rest, length 1 at full tilt), plus whether a thumb is on it. It is a
 * `Controls.Vector`, so `Controls` merges it like any vector.
 */
export interface StickState extends Vector {
  /** Whether a thumb is on the stick. */
  readonly active: boolean
}

/** One button's state: its action's edges, plus the drag aim and whether the release was cancelled. */
export interface ButtonState extends ActionState {
  /**
   * The drag from the button's center as a fraction of `aimRadius` (length at
   * most 1), or `null` for a tap, a button without aim, or a button not held.
   * On a release it is the aim at the moment the finger lifted.
   */
  readonly aim: Vector | null
  /** The release came from a cancelled touch, not a finger lifting. */
  readonly cancelled: boolean
}

/** The swipe area's state in a snapshot. */
export interface Swipe {
  /** Whether a finger is on the swipe area. */
  readonly active: boolean
  /** How far the finger moved since the previous snapshot, in CSS pixels. */
  readonly delta: Vector
}

/**
 * The controls' state. Each button is an action named like it and each
 * stick a vector named like it, so the snapshot has the same core as the
 * other devices' (`actions`, `vectors`, and `used`) and `Controls` can
 * merge it.
 */
export interface Snapshot<B extends string, V extends string = never> {
  readonly actions: { readonly [K in B]: ButtonState }
  /** Each stick's vector, and whether a thumb is on it. */
  readonly vectors: { readonly [K in V]: StickState }
  readonly swipe: Swipe
  /**
   * A button was pressed in this window or is held, or a finger is on a
   * stick or the swipe area: the player is using the touch controls.
   */
  readonly used: boolean
}

const snapshotOf = <B extends string, V extends string>(
  vectors: { readonly [K in V]: StickState },
  actions: { readonly [K in B]: ButtonState },
  swipe: Swipe
): Snapshot<B, V> => {
  let held = false
  for (const name in vectors) held ||= vectors[name].active
  return { actions, vectors, swipe, used: held || swipe.active || anyUsed(actions) }
}

/** Where a held stick was centered and where its knob is drawn (on the rim at most). */
export interface StickView {
  readonly origin: Position
  readonly knob: Position
}

/** Live control positions for drawing, in CSS pixels. Reading it consumes nothing. */
export interface View<B extends string, V extends string = never, H extends B | V = B | V> {
  /** The layout in use; only the controls in `H`, the ones the layout function can hide, may be `null`. */
  readonly layout: Layout<B, V, H>
  /** Each stick while a thumb holds it, `null` otherwise. */
  readonly sticks: { readonly [K in V]: StickView | null }
  readonly buttons: { readonly [K in B]: { readonly held: boolean; readonly aim: Vector | null } }
}

/**
 * Touch controls, built with {@link actions} (live) or {@link scripted}.
 * Capture them with `InputCapture.system(...)`, or merge them with
 * `Controls` (through `lacking(...)` for actions with no on-screen
 * control). There is no `rebind`: the layout is the binding.
 */
export interface Actions<B extends string, V extends string = never, H extends B | V = B | V> extends System.Consumes<"snapshot"> {
  /** Returns the controls' state and starts a new press/release window. */
  snapshot(): Snapshot<B, V>
  /** The live state for drawing. */
  view(): View<B, V, H>
  /** Removes the event listeners and restores the element's `touch-action`. */
  dispose(): void
}

/** The subset of `PointerEvent` the module reads. */
export interface TouchEventLike {
  readonly clientX: number
  readonly clientY: number
  readonly pointerId: number
  readonly pointerType: string
  preventDefault(): void
}

/** The element the controls are over, usually the game canvas. */
export interface TouchTarget {
  addEventListener(type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", listener: (event: TouchEventLike) => void): void
  removeEventListener(type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", listener: (event: TouchEventLike) => void): void
  getBoundingClientRect(): { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
  setPointerCapture?(pointerId: number): void
  readonly style?: { touchAction: string }
}

/** Where window blur is observed, usually `window`. Held controls are cancelled on blur. */
export interface BlurHost {
  addEventListener(type: "blur", listener: () => void): void
  removeEventListener(type: "blur", listener: () => void): void
}

/** Options for {@link actions}. */
export interface ActionsOptions {
  /** `PointerEvent.pointerType`s that drive the controls. Defaults to `["touch"]`. */
  readonly pointerTypes?: ReadonlyArray<string>
}

const zero: Vector = { x: 0, y: 0 }

const resting: StickState = { x: 0, y: 0, active: false }

const released = (): ButtonState => ({ held: false, pressed: false, released: false, aim: null, cancelled: false })

/** The names a layout's controls report, for {@link idle} and {@link scripted}. */
export interface Names<B extends string, V extends string = never> {
  /** The layout's button keys: the actions they report. */
  readonly buttons: ReadonlyArray<B>
  /** The layout's stick keys: the vectors they drive (`[]` for buttons only). */
  readonly sticks: ReadonlyArray<V>
}

/** Rejects a name given both as a stick and as a button. */
export type DistinctNames<B extends string, V extends string> = [B & V] extends [never]
  ? unknown
  : `${B & V} names both a stick and a button: give them different names`

const byName = <K extends string, T>(names: ReadonlyArray<K>, value: (name: K) => T): { readonly [P in K]: T } =>
  Object.fromEntries(names.map((name) => [name, value(name)])) as { readonly [P in K]: T }

/**
 * A snapshot with nothing held, for initializing an input resource before
 * the first capture: pass the layout's button and stick names, as
 * `Touch.idle({ buttons: ["dash"], sticks: ["move", "aim"] })`.
 */
export const idle = <const B extends string, const V extends string = never>(names: Names<B, V> & DistinctNames<B, V>): Snapshot<B, V> =>
  snapshotOf<B, V>(byName(names.sticks, () => resting), byName(names.buttons, released), { active: false, delta: zero })

/** `offset / radius`, clamped to length 1, with the inner `deadZone` fraction mapped to zero. */
const tilt = (offset: Position, radius: number, deadZone: number): Vector => {
  const length = Math.sqrt(offset.x * offset.x + offset.y * offset.y)
  if (radius <= 0 || length <= deadZone * radius) return zero
  const strength = Math.min(1, (length / radius - deadZone) / (1 - deadZone))
  return { x: (offset.x / length) * strength, y: (offset.y / length) * strength }
}

/** `offset / aimRadius` clamped to length 1, or `null` inside the tap dead zone. */
const aimOf = (zone: ButtonZone, at: Position): Vector | null => {
  if (zone.aimRadius === undefined) return null
  const offset = { x: at.x - zone.center.x, y: at.y - zone.center.y }
  const length = Math.sqrt(offset.x * offset.x + offset.y * offset.y)
  if (length <= (zone.aimDeadZone ?? 0.2) * zone.aimRadius) return null
  const scale = Math.min(1, length / zone.aimRadius) / length
  return { x: offset.x * scale, y: offset.y * scale }
}

const inside = (rect: Rect, at: Position): boolean =>
  at.x >= rect.left && at.x <= rect.left + rect.width && at.y >= rect.top && at.y <= rect.top + rect.height

/** Button state between snapshots. */
interface ButtonTrack {
  held: boolean
  pressed: boolean
  released: boolean
  cancelled: boolean
  /** Live aim while held; the aim at release until the next snapshot. */
  aim: Vector | null
}

const makeButtonTracks = <B extends string>(names: ReadonlyArray<B>): Map<B, ButtonTrack> =>
  new Map(names.map((name) => [name, { held: false, pressed: false, released: false, cancelled: false, aim: null }]))

const buttonSnapshot = (track: ButtonTrack): ButtonState => ({
  held: track.held,
  pressed: track.pressed,
  released: track.released && !track.held,
  aim: track.aim,
  cancelled: track.released && !track.held && track.cancelled
})

/** Clears the edges after a snapshot, and the release aim of lifted buttons. */
const startWindow = (track: ButtonTrack): void => {
  track.pressed = false
  track.released = false
  track.cancelled = false
  if (!track.held) track.aim = null
}

const press = (track: ButtonTrack, aim: Vector | null): void => {
  track.held = true
  track.pressed = true
  track.aim = aim
}

const lift = (track: ButtonTrack, cancelled: boolean): void => {
  if (!track.held) return
  track.held = false
  track.released = true
  track.cancelled = cancelled
}

/** A held stick between snapshots: its finger, where it was centered, and the thumb. */
interface StickTrack {
  readonly pointerId: number
  readonly origin: Position
  knob: Position
}

/**
 * Starts tracking touches over `target` with the controls `layout` returns
 * for the element's current size. The layout is read again on every
 * snapshot and every new touch, so a resize or a control the game hides
 * (`null`) takes effect at once; keep it cheap, since it runs every update.
 * A held control that turns `null` releases with `cancelled: true`, and its
 * finger does nothing until it lifts. `blurHost` (usually `window`) cancels
 * held controls when the page loses focus. Use `Pointer.actions` for mouse
 * and pen input.
 */
export const actions = <const B extends string, const V extends string = never, L extends Layout<B, V> = Layout<B, V>>(
  target: TouchTarget,
  blurHost: BlurHost,
  layout: (size: Size) => Layout<B, V> & L,
  options: ActionsOptions = {}
): Actions<B, V, Hideable<L>> => {
  const pointerTypes = options.pointerTypes ?? ["touch"]
  const sizeOf = (): Size => {
    const rect = target.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  }
  let current = layout(sizeOf())
  /** The stick zones of the current layout; names that clash with a button do not compile. */
  const zoneOf = (name: V): StickZone | null => current.sticks[name] as StickZone | null
  const names = Object.keys(current.buttons) as Array<B>
  const stickNames = Object.keys(current.sticks) as Array<V>
  const buttons = makeButtonTracks(names)
  /** The finger and positions of each held stick. */
  const sticks = new Map<V, StickTrack>()
  /** Which button each finger holds. */
  const fingers = new Map<number, B>()
  let swipe: { readonly pointerId: number; last: Position } | undefined
  /** Swipe movement since the previous snapshot, including fingers already lifted. */
  let swiped: Vector = zero

  const locate = (event: TouchEventLike): Position => {
    const rect = target.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const tracked = (event: TouchEventLike): boolean => pointerTypes.includes(event.pointerType)

  const stickOf = (pointerId: number): V | undefined => {
    for (const [name, stick] of sticks) if (stick.pointerId === pointerId) return name
    return undefined
  }

  /**
   * Reads the layout again and lets go of the controls it hides: a held
   * button releases as a cancel, and its finger, like a hidden stick's or
   * swipe's, is forgotten, so it does nothing until it lifts.
   */
  const relayout = (): void => {
    current = layout(sizeOf())
    for (const [pointerId, name] of fingers) {
      if (current.buttons[name] !== null) continue
      fingers.delete(pointerId)
      lift(buttons.get(name)!, true)
    }
    for (const name of sticks.keys()) if (zoneOf(name) === null) sticks.delete(name)
    if (current.swipe === undefined) swipe = undefined
  }

  const onDown = (event: TouchEventLike): void => {
    if (!tracked(event)) return
    event.preventDefault()
    // A pointer id that comes down again without an up in between (the up
    // was lost) releases what it held first, as a cancel.
    end(event, true)
    relayout()
    const at = locate(event)
    for (const name of names) {
      const zone = current.buttons[name]
      const button = buttons.get(name)!
      if (zone === null) continue
      const dx = at.x - zone.center.x
      const dy = at.y - zone.center.y
      if (button.held || dx * dx + dy * dy > zone.radius * zone.radius) continue
      press(button, aimOf(zone, at))
      fingers.set(event.pointerId, name)
      target.setPointerCapture?.(event.pointerId)
      return
    }
    for (const name of stickNames) {
      const zone = zoneOf(name)
      if (zone === null || sticks.has(name) || !inside(zone.region, at)) continue
      sticks.set(name, { pointerId: event.pointerId, origin: at, knob: at })
      target.setPointerCapture?.(event.pointerId)
      return
    }
    if (swipe === undefined && current.swipe !== undefined && inside(current.swipe.region, at)) {
      swipe = { pointerId: event.pointerId, last: at }
      target.setPointerCapture?.(event.pointerId)
    }
  }

  const onMove = (event: TouchEventLike): void => {
    if (!tracked(event)) return
    const at = locate(event)
    const stick = stickOf(event.pointerId)
    if (stick !== undefined) {
      sticks.get(stick)!.knob = at
      return
    }
    if (swipe !== undefined && swipe.pointerId === event.pointerId) {
      swiped = { x: swiped.x + at.x - swipe.last.x, y: swiped.y + at.y - swipe.last.y }
      swipe.last = at
      return
    }
    const name = fingers.get(event.pointerId)
    const zone = name === undefined ? null : current.buttons[name]
    if (name !== undefined && zone !== null) buttons.get(name)!.aim = aimOf(zone, at)
  }

  const end = (event: TouchEventLike, cancelled: boolean): void => {
    if (!tracked(event)) return
    const stick = stickOf(event.pointerId)
    if (stick !== undefined) {
      sticks.delete(stick)
      return
    }
    if (swipe !== undefined && swipe.pointerId === event.pointerId) {
      swipe = undefined
      return
    }
    const name = fingers.get(event.pointerId)
    if (name === undefined) return
    fingers.delete(event.pointerId)
    const button = buttons.get(name)!
    const zone = current.buttons[name]
    if (!cancelled && zone !== null) button.aim = aimOf(zone, locate(event))
    lift(button, cancelled)
  }

  const onUp = (event: TouchEventLike): void => end(event, false)
  const onCancel = (event: TouchEventLike): void => end(event, true)
  const onBlur = (): void => {
    sticks.clear()
    swipe = undefined
    fingers.clear()
    for (const button of buttons.values()) lift(button, true)
  }

  const previousTouchAction = target.style?.touchAction
  if (target.style !== undefined) target.style.touchAction = "none"
  target.addEventListener("pointerdown", onDown)
  target.addEventListener("pointermove", onMove)
  target.addEventListener("pointerup", onUp)
  target.addEventListener("pointercancel", onCancel)
  blurHost.addEventListener("blur", onBlur)

  const stickState = (name: V): StickState => {
    const stick = sticks.get(name)
    const zone = zoneOf(name)
    if (stick === undefined || zone === null) return resting
    const offset = { x: stick.knob.x - stick.origin.x, y: stick.knob.y - stick.origin.y }
    const vector = tilt(offset, zone.radius, zone.deadZone ?? 0.15)
    return { x: vector.x, y: vector.y, active: true }
  }

  const stickView = (name: V): StickView | null => {
    const stick = sticks.get(name)
    const zone = zoneOf(name)
    if (stick === undefined || zone === null) return null
    const radius = zone.radius
    const offset = { x: stick.knob.x - stick.origin.x, y: stick.knob.y - stick.origin.y }
    const length = Math.sqrt(offset.x * offset.x + offset.y * offset.y)
    const scale = length > radius ? radius / length : 1
    return { origin: stick.origin, knob: { x: stick.origin.x + offset.x * scale, y: stick.origin.y + offset.y * scale } }
  }

  return {
    snapshot() {
      relayout()
      const snapshot = snapshotOf<B, V>(
        byName(stickNames, stickState),
        byName(names, (name) => buttonSnapshot(buttons.get(name)!)),
        { active: swipe !== undefined, delta: swiped }
      )
      for (const button of buttons.values()) startWindow(button)
      swiped = zero
      return snapshot
    },
    view() {
      return {
        // `current` is what the layout function returned, so its zones are `null` only where `Hideable<L>` says.
        layout: current as unknown as Layout<B, V, Hideable<L>>,
        sticks: byName(stickNames, stickView),
        buttons: byName(names, (name) => {
          const button = buttons.get(name)!
          return { held: button.held, aim: button.held ? button.aim : null }
        })
      }
    },
    dispose() {
      target.removeEventListener("pointerdown", onDown)
      target.removeEventListener("pointermove", onMove)
      target.removeEventListener("pointerup", onUp)
      target.removeEventListener("pointercancel", onCancel)
      blurHost.removeEventListener("blur", onBlur)
      if (target.style !== undefined && previousTouchAction !== undefined) target.style.touchAction = previousTouchAction
    }
  }
}

/**
 * Control changes applied just before one snapshot, in this order: the sticks
 * and swipe, presses, aims, releases. `frame` is the snapshot's index, counting from 0 at
 * the first `snapshot()` call. A button pressed and released in one frame is a
 * tap shorter than a frame.
 */
export interface TimelineEntry<B extends string, V extends string = never> {
  readonly frame: number
  /** Stick vectors from this frame on, by stick name; `null` lifts the thumb. */
  readonly sticks?: { readonly [K in V]?: Vector | null }
  /** A swipe of this many CSS pixels reported by this frame's snapshot only. */
  readonly swipe?: Vector
  readonly press?: ReadonlyArray<B>
  /** Aims of held buttons from this frame on (`null` for no aim). */
  readonly aim?: { readonly [K in B]?: Vector | null }
  readonly release?: ReadonlyArray<B>
  /** Releases that cancel instead of lifting. */
  readonly cancel?: ReadonlyArray<B>
}

/** Control changes by snapshot index. Plain data, so it round-trips through JSON. */
export type Timeline<B extends string, V extends string = never> = ReadonlyArray<TimelineEntry<B, V>>

/** Touch controls driven by a timeline instead of an element. */
export interface Scripted<B extends string, V extends string = never> extends Actions<B, V> {
  /** Number of snapshots taken so far, which is the next frame index. */
  readonly frames: () => number
}

/**
 * Plays `timeline` over controls with `names` (the buttons, and the sticks
 * by the vectors they drive): before the snapshot at index `frame`, every
 * entry for that frame is applied. Vectors longer than 1 are clamped.
 */
export const scripted = <const B extends string, const V extends string = never>(
  names: Names<B, V> & DistinctNames<B, V>,
  timeline: Timeline<NoInfer<B>, NoInfer<V>>
): Scripted<B, V> => {
  const buttons = names.buttons
  const stickNames = names.sticks
  const byFrame = new Map<number, Array<TimelineEntry<B, V>>>()
  for (const entry of timeline) {
    const entries = byFrame.get(entry.frame)
    if (entries) entries.push(entry)
    else byFrame.set(entry.frame, [entry])
  }
  const clamp = (vector: Vector): Vector => {
    const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y)
    return length <= 1 ? vector : { x: vector.x / length, y: vector.y / length }
  }
  const tracks = makeButtonTracks(buttons)
  /** Each held stick's vector. */
  const sticks = new Map<V, Vector>()
  let frame = 0
  const layout = {
    sticks: byName(stickNames, () => ({ region: { left: 0, top: 0, width: 0, height: 0 }, radius: 1 })),
    buttons: byName(buttons, () => ({ center: zero, radius: 0 }))
  } as Layout<B, V>
  return {
    snapshot() {
      for (const track of tracks.values()) startWindow(track)
      const swipe = { active: false, x: 0, y: 0 }
      for (const entry of byFrame.get(frame) ?? []) {
        if (entry.swipe !== undefined) {
          swipe.active = true
          swipe.x += entry.swipe.x
          swipe.y += entry.swipe.y
        }
        for (const [name, vector] of Object.entries(entry.sticks ?? {}) as Array<[V, Vector | null | undefined]>) {
          if (vector === undefined || !stickNames.includes(name)) continue
          if (vector === null) sticks.delete(name)
          else sticks.set(name, clamp(vector))
        }
        for (const name of entry.press ?? []) press(tracks.get(name)!, null)
        for (const [name, aim] of Object.entries(entry.aim ?? {}) as Array<[B, Vector | null | undefined]>) {
          const track = tracks.get(name)
          if (track !== undefined && aim !== undefined) track.aim = aim === null ? null : clamp(aim)
        }
        for (const name of entry.release ?? []) lift(tracks.get(name)!, false)
        for (const name of entry.cancel ?? []) lift(tracks.get(name)!, true)
      }
      frame += 1
      return snapshotOf<B, V>(
        byName(stickNames, (name) => {
          const vector = sticks.get(name)
          return vector === undefined ? resting : { x: vector.x, y: vector.y, active: true }
        }),
        byName(buttons, (name) => buttonSnapshot(tracks.get(name)!)),
        { active: swipe.active, delta: { x: swipe.x, y: swipe.y } }
      )
    },
    view() {
      return {
        layout,
        sticks: byName(stickNames, () => null),
        buttons: byName(buttons, (name) => {
          const track = tracks.get(name)!
          return { held: track.held, aim: track.held ? track.aim : null }
        })
      }
    },
    dispose() {},
    frames: () => frame
  }
}
