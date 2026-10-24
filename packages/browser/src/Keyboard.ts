/**
 * Keyboard input as caller-named actions.
 *
 * Games bind actions to keys once and read one snapshot per update. The
 * module owns the browser plumbing every game rewrites: key normalization,
 * `preventDefault` for bound keys, press/release edges that survive taps
 * shorter than one frame, clearing on window blur, and listener cleanup. It
 * does not know about the ECS; `InputCapture.system(...)` copies snapshots
 * from a service into a resource.
 *
 * Bind by character (`"w"`) or by physical key (`Keyboard.code("KeyW")`);
 * see {@link KeyBinding}. A key released while a modifier changed its
 * character (W pressed, then Option, then W released as "∑") still releases
 * its action.
 *
 * Some combinations never reach the page: browsers reserve shortcuts such as
 * Ctrl+W / Cmd+W (close tab), Ctrl+T / Cmd+T, and Cmd+Q, and pages cannot
 * prevent them. Avoid Ctrl and Cmd as held modifiers in games.
 *
 * Keys typed into a form field are left to the field: a key that goes down
 * in an `<input>` (any type), `<textarea>`, `<select>`, or contenteditable
 * element presses no action and is not `preventDefault`-ed, so a name field
 * on the same page as the game receives "wasd" and the player does not move.
 * Releases are always processed, so a key held before focus moved into a
 * field still releases its action. With `window` as the host this needs no
 * setup.
 *
 * @module Keyboard
 * @docGroup browser
 *
 * @example
 * ```ts
 * const input = Keyboard.actions(window, {
 *   left: ["ArrowLeft", "a"],
 *   right: ["ArrowRight", "d"],
 *   jump: [" ", "ArrowUp", "w"]
 * })
 *
 * // Once per update:
 * const snapshot = input.snapshot()
 * if (snapshot.actions.jump.pressed) jump()
 *
 * // On teardown:
 * input.dispose()
 * ```
 *
 * Movement is one vector action: `move: Keyboard.vector({ up, down, left,
 * right })` reports `vectors.move` with length at most 1 (opposite keys
 * cancel, diagonals are not faster). Timelines name it by direction,
 * `"move.right"`.
 *
 * For a controls settings screen, `presses(...)` reports every key that
 * goes down (bound or not) so the screen can wait for the key to bind,
 * `rebind(...)` swaps the keys of the same actions, and `parseRebinding(...)`
 * validates bindings saved as JSON.
 *
 * For tests, replays, and headless runs, `scripted(...)` plays a timeline of
 * presses and releases instead of listening to a host, and `recording(...)`
 * wraps live actions to capture the timeline a session produced.
 * `parseTimeline(...)` validates a timeline loaded from JSON.
 *
 * @example
 * ```ts
 * // Browser: record a session, then save `recorder.timeline()` as JSON.
 * const recorder = Keyboard.recording(Keyboard.actions(window, bindings))
 *
 * // Node: replay it frame by frame.
 * const parsed = Keyboard.parseTimeline(bindings, JSON.parse(saved))
 * if (parsed.ok) {
 *   const replay = Keyboard.scripted(bindings, parsed.value)
 * }
 * ```
 */
import type * as System from "@typeonce/ritmo/System"
import * as Result from "@typeonce/ritmo/Result"

import { boundKeys } from "./internal/introspect.ts"
import type { ReportsBoundKeys } from "./internal/introspect.ts"
import { anyUsed } from "./internal/used.ts"
import { digital, directionName, directions, isVectorBinding, zero } from "./internal/vectors.ts"
import type { ActionState } from "./internal/state.ts"
import type { Direction, Vector } from "./internal/vectors.ts"

export type { Direction }

/**
 * The subset of `KeyboardEvent` the module reads. `code` (the physical key)
 * and `target` (the element the key was typed into) are optional so simple
 * test hosts can omit them; browsers always provide them.
 *
 * A target is a form field, whose key presses {@link actions} and
 * {@link presses} leave to it, when its `tagName` is `INPUT` (any type,
 * checkboxes and buttons included), `TEXTAREA`, or `SELECT`, or its
 * `isContentEditable` is `true`. It is read by shape, not `instanceof`, so
 * it works across iframes, and a test host types into a field by passing
 * `{ tagName: "INPUT" }` or `{ isContentEditable: true }`.
 */
export interface KeyEvent {
  readonly key: string
  readonly code?: string
  readonly repeat: boolean
  readonly target?: object | null
  preventDefault(): void
}

const editableTags: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA", "SELECT"])

/** Whether a key event's target is a form field, by the rule on {@link KeyEvent}. */
const isEditableTarget = (target: object | null | undefined): boolean => {
  if (target === null || target === undefined) return false
  const { tagName, isContentEditable } = target as { readonly tagName?: unknown; readonly isContentEditable?: unknown }
  return isContentEditable === true || (typeof tagName === "string" && editableTags.has(tagName.toUpperCase()))
}

/**
 * The event target the module listens on, usually `window`.
 */
export interface KeyboardHost {
  addEventListener(type: "keydown" | "keyup", listener: (event: KeyEvent) => void): void
  addEventListener(type: "blur", listener: () => void): void
  removeEventListener(type: "keydown" | "keyup", listener: (event: KeyEvent) => void): void
  removeEventListener(type: "blur", listener: () => void): void
}

/**
 * A key matched by physical position (`KeyboardEvent.code`, for example
 * `"KeyW"`, `"Digit1"`, `"ShiftLeft"`), whatever character it types. Build it
 * with {@link code}.
 */
export interface PhysicalKey {
  readonly code: string
}

/**
 * One key that triggers an action: a `KeyboardEvent.key` value (the
 * character typed; single characters match case-insensitively) or a
 * {@link PhysicalKey}.
 *
 * Character bindings follow the keyboard layout and are what a menu should
 * show. Physical bindings keep a position fixed: WASD stays under the left
 * hand on AZERTY keyboards, and modifiers cannot change the match (with
 * Option held on macOS, W types "∑"; with Shift, 1 types "!").
 */
export type KeyBinding = string | PhysicalKey

/** The keys of one action: at least one. */
export type Keys = readonly [KeyBinding, ...Array<KeyBinding>]

/**
 * Keys for the four directions of a vector action (movement), built with
 * {@link vector}.
 */
export interface VectorBinding {
  readonly _tag: "Vector"
  readonly up: Keys
  readonly down: Keys
  readonly left: Keys
  readonly right: Keys
}

/**
 * Action name to the keys that trigger it (at least one), or to a
 * {@link vector} binding for a direction such as movement.
 */
export type Bindings = Readonly<Record<string, Keys | VectorBinding>>

/** The bound button actions: the names bound to keys. */
export type ButtonNames<B> = { [K in keyof B]: B[K] extends VectorBinding ? never : K }[keyof B] & string

/** The bound vector actions: the names bound with {@link vector}. */
export type VectorNames<B> = { [K in keyof B]: B[K] extends VectorBinding ? K : never }[keyof B] & string

/**
 * Binds a vector action to keys for its four directions. The snapshot's
 * `vectors` reports it with length at most 1: opposite keys cancel and a
 * diagonal is not faster than a straight line.
 *
 * @example
 * ```ts
 * const bindings = {
 *   move: Keyboard.vector({ up: ["w", "ArrowUp"], down: ["s", "ArrowDown"], left: ["a", "ArrowLeft"], right: ["d", "ArrowRight"] }),
 *   jump: [" "]
 * } as const
 * ```
 */
export const vector = (keys: { readonly up: Keys; readonly down: Keys; readonly left: Keys; readonly right: Keys }): VectorBinding => ({
  _tag: "Vector",
  up: keys.up,
  down: keys.down,
  left: keys.left,
  right: keys.right
})

/**
 * A binding to a physical key by its `KeyboardEvent.code`.
 *
 * @example
 * ```ts
 * const bindings = {
 *   up: [Keyboard.code("KeyW")],
 *   jump: [Keyboard.code("Space")]
 * } as const
 * ```
 */
export const code = <const Code extends string>(code: Code): PhysicalKey & { readonly code: Code } => ({ code })

/**
 * Every action's state, with the same core as the other devices' snapshots
 * (`actions`, `vectors`, and `used`) so `Controls` can merge them.
 */
export interface Snapshot<B extends Bindings> {
  readonly actions: { readonly [Action in ButtonNames<B>]: ActionState }
  /** Each vector action's direction, length at most 1, `y` growing down. */
  readonly vectors: { readonly [Action in VectorNames<B>]: Vector }
  /** Some key bound to an action was pressed in this window or is held: the player is using the keyboard. */
  readonly used: boolean
}

/**
 * New keys for the same actions, for {@link Actions.rebind}: keys for a
 * button action, a {@link vector} for a vector action. Load saved ones with
 * {@link parseRebinding}.
 */
export type Rebinding<B extends Bindings> = { readonly [Action in keyof B]: B[Action] extends VectorBinding ? VectorBinding : Keys }

/**
 * Rejects actions a rebinding names that the bindings do not have, so
 * {@link Actions.rebind} takes exactly the actions it was made with.
 */
export type OnlyActionsOf<R, B extends Bindings> = {
  readonly [Name in Exclude<keyof R, keyof B>]: `${Name & string} is not an action of these bindings`
}

/**
 * A keyboard bound to actions, built with {@link actions} (live),
 * {@link scripted}, or {@link recording}. Capture it with
 * `InputCapture.system(...)`, or merge it with `Controls`.
 */
export interface Actions<B extends Bindings> extends System.Consumes<"snapshot"> {
  /**
   * Returns every action's state and starts a new press/release window.
   */
  snapshot(): Snapshot<B>
  /**
   * Binds the same actions to new keys, from the next snapshot, for a
   * settings screen where players remap controls (capture the key to bind
   * with {@link presses}). An action held only through keys it lost reports
   * `released`. A key held across the rebind holds a newly bound action only
   * once it is pressed again, so an action never turns held without a
   * press. It takes exactly the actions the source was made with.
   */
  rebind<const R extends Rebinding<B>>(bindings: R & OnlyActionsOf<R, B>): void
  /**
   * Removes the event listeners.
   */
  dispose(): void
}

/** Options for {@link actions}. */
export interface ActionsOptions {
  /**
   * Call `preventDefault()` for bound keys, so arrows and space do not scroll
   * the page. Defaults to `true`.
   */
  readonly preventDefault?: boolean
}

/**
 * A snapshot with every action idle, for initializing an input resource
 * before the first capture.
 */
export const idle = <const B extends Bindings>(bindings: B): Snapshot<B> => {
  const idleState: ActionState = { held: false, pressed: false, released: false }
  return assemble(bindings, () => idleState, false) as Snapshot<B>
}

/** Each action's keys, with every vector action split into its four directions (`move.up`, ...). */
const flatten = (bindings: Bindings): Readonly<Record<string, Keys>> => {
  const flat: Record<string, Keys> = {}
  for (const [name, entry] of Object.entries(bindings)) {
    if (isVectorBinding(entry)) {
      for (const direction of directions) flat[directionName(name, direction)] = (entry as VectorBinding)[direction]
    } else flat[name] = entry as Keys
  }
  return flat
}

/** The snapshot for `bindings` from the state of each flat action (button actions and vector directions). */
const assemble = (bindings: Bindings, state: (name: string) => ActionState, used: boolean): Snapshot<Bindings> => {
  const actions: Record<string, ActionState> = {}
  const vectors: Record<string, Vector> = {}
  for (const [name, entry] of Object.entries(bindings)) {
    if (isVectorBinding(entry)) {
      const held = (direction: Direction): boolean => state(directionName(name, direction)).held
      vectors[name] = digital(held("up"), held("down"), held("left"), held("right"))
    } else actions[name] = state(name)
  }
  return { actions, vectors, used } as Snapshot<Bindings>
}

/**
 * The flat action states behind the last snapshot of a live or scripted
 * keyboard, so `recording` sees each direction of a vector action.
 */
const flatStates = Symbol("Keyboard/flatStates")

interface WithFlatStates {
  readonly [flatStates]?: () => Readonly<Record<string, ActionState>>
}

const normalize = (key: string): string => key.length === 1 ? key.toLowerCase() : key

/** One internal lookup token per binding: characters and physical codes never collide. */
const keyToken = (key: string): string => `key:${normalize(key)}`
const codeToken = (code: string): string => `code:${code}`
const bindingToken = (binding: KeyBinding): string => typeof binding === "string" ? keyToken(binding) : codeToken(binding.code)

/** How a binding reads in a lint: the character quoted, a physical key by its code. */
const bindingLabel = (binding: KeyBinding): string => typeof binding === "string" ? JSON.stringify(normalize(binding)) : binding.code

const labelsOf = (flat: Readonly<Record<string, Keys>>): ReadonlyArray<string> =>
  [...new Set(Object.values(flat).flatMap((keys) => keys.map(bindingLabel)))]

/**
 * Starts tracking bound keys on `host`, usually `window`, until `dispose()`.
 * When the window loses focus every held action is released. A key pressed
 * in a form field (see {@link KeyEvent}) is left to the field: it
 * presses no action and is not `preventDefault`-ed. Each call is
 * its own device: build one per source (one `Controls` merge, one player
 * of a pool). Use {@link scripted} for tests and headless runs, and
 * {@link presses} to capture an unbound key on a settings screen.
 */
export const actions = <const B extends Bindings>(
  host: KeyboardHost,
  initial: B,
  options: ActionsOptions = {}
): Actions<B> => {
  const preventDefault = options.preventDefault ?? true
  // Fixed at creation: a rebind swaps keys, never the actions. Vector
  // actions are tracked as their four directions.
  const names = Object.keys(flatten(initial))
  let bindings = flatten(initial)
  const actionsByToken = new Map<string, Array<string>>()
  const index = (): void => {
    actionsByToken.clear()
    for (const name of names) {
      for (const binding of bindings[name]!) {
        const token = bindingToken(binding)
        const bound = actionsByToken.get(token)
        if (bound) bound.push(name)
        else actionsByToken.set(token, [name])
      }
    }
  }
  index()

  /**
   * Each held token and the actions it holds: those bound to it when it went
   * down that are still bound to it. A token stays here while held even if a
   * rebind unbound it, so its release is still seen.
   */
  const heldTokens = new Map<string, Set<string>>()
  /**
   * The character token each physical key produced when it went down, so its
   * release matches even if a modifier changed the character meanwhile
   * (W pressed, Option pressed, W released as "∑").
   */
  const keyTokenByCode = new Map<string, string>()
  const pressed = new Set<string>()
  const released = new Set<string>()

  const onKeyDown = (event: KeyEvent): void => {
    // Typed into a form field: the key belongs to the field. Its release is
    // still processed by `onKeyUp`.
    if (isEditableTarget(event.target)) return
    const tokens = [keyToken(event.key)]
    if (event.code !== undefined) {
      if (!keyTokenByCode.has(event.code)) keyTokenByCode.set(event.code, tokens[0]!)
      tokens.push(codeToken(event.code))
    }
    let handled = false
    for (const token of tokens) {
      const bound = actionsByToken.get(token)
      if (!bound) continue
      handled = true
      if (event.repeat || heldTokens.has(token)) continue
      heldTokens.set(token, new Set(bound))
      for (const name of bound) pressed.add(name)
    }
    if (handled && preventDefault) event.preventDefault()
  }

  // Releases are processed wherever the key was released, form fields
  // included, so a key held before focus moved into a field still releases.
  const onKeyUp = (event: KeyEvent): void => {
    const tokens = [keyToken(event.key)]
    if (event.code !== undefined) {
      const downAs = keyTokenByCode.get(event.code)
      keyTokenByCode.delete(event.code)
      if (downAs !== undefined) tokens[0] = downAs
      tokens.push(codeToken(event.code))
    }
    for (const token of tokens) {
      const holding = heldTokens.get(token)
      if (!holding) continue
      heldTokens.delete(token)
      for (const name of holding) released.add(name)
    }
  }

  const onBlur = (): void => {
    for (const holding of heldTokens.values()) {
      for (const name of holding) released.add(name)
    }
    heldTokens.clear()
    keyTokenByCode.clear()
  }

  host.addEventListener("keydown", onKeyDown)
  host.addEventListener("keyup", onKeyUp)
  host.addEventListener("blur", onBlur)

  const isHeld = (name: string): boolean => {
    for (const binding of bindings[name]!) {
      if (heldTokens.get(bindingToken(binding))?.has(name)) return true
    }
    return false
  }

  let last: Readonly<Record<string, ActionState>> = {}
  const live: Actions<B> & WithFlatStates & ReportsBoundKeys = {
    [boundKeys]: () => labelsOf(bindings),
    snapshot() {
      const states: Record<string, ActionState> = {}
      for (const name of names) {
        const held = isHeld(name)
        states[name] = {
          held,
          pressed: pressed.has(name),
          released: released.has(name) && !held
        }
      }
      pressed.clear()
      released.clear()
      last = states
      return assemble(initial, (name) => states[name]!, anyUsed(states)) as Snapshot<B>
    },
    [flatStates]: () => last,
    rebind(next) {
      const before = names.filter(isHeld)
      bindings = flatten(next as Bindings)
      index()
      // A held key keeps only the actions still bound to it; new ones wait for a fresh press.
      for (const [token, holding] of heldTokens) {
        const bound = actionsByToken.get(token) ?? []
        for (const name of holding) if (!bound.includes(name)) holding.delete(name)
      }
      for (const name of before) if (!isHeld(name)) released.add(name)
    },
    dispose() {
      host.removeEventListener("keydown", onKeyDown)
      host.removeEventListener("keyup", onKeyUp)
      host.removeEventListener("blur", onBlur)
    }
  }
  return live
}

/** One key that went down, in the two forms a {@link KeyBinding} can name it. */
export interface KeyPress {
  /** The character typed (`KeyboardEvent.key`), for a character binding. */
  readonly key: string
  /** The physical key (`KeyboardEvent.code`), for `Keyboard.code(...)`; `null` when the host gave none. */
  readonly code: string | null
}

/** Every key press on a host, bound or not; see {@link presses}. */
export interface Presses extends System.Consumes<"snapshot"> {
  /** The keys that went down since the previous snapshot, in order, without auto-repeats. */
  snapshot(): ReadonlyArray<KeyPress>
  /** Removes the event listener. */
  dispose(): void
}

/**
 * Starts collecting every key press on `host`, whatever the bindings, for a
 * settings screen that waits for the key to bind. Use {@link actions} for
 * gameplay. It never calls `preventDefault()`, and skips keys pressed in a
 * form field (see {@link KeyEvent}).
 *
 * @example
 * ```ts
 * const presses = Keyboard.presses(window)
 *
 * // While the settings screen waits for the new jump key:
 * const press = presses.snapshot()[0]
 * if (press !== undefined) {
 *   input.rebind({ ...current, jump: [press.code === null ? press.key : Keyboard.code(press.code)] })
 * }
 * ```
 */
export const presses = (host: KeyboardHost): Presses => {
  let pending: Array<KeyPress> = []
  const onKeyDown = (event: KeyEvent): void => {
    if (event.repeat || isEditableTarget(event.target)) return
    pending.push({ key: event.key, code: event.code ?? null })
  }
  host.addEventListener("keydown", onKeyDown)
  return {
    snapshot() {
      const snapshot = pending
      pending = []
      return snapshot
    },
    dispose() {
      host.removeEventListener("keydown", onKeyDown)
    }
  }
}

/**
 * Input changes applied just before one snapshot. `frame` is the snapshot's
 * index, counting from 0 at the first `snapshot()` call. Entries name
 * actions, and a vector action by direction (`"move.right"`). An action in both
 * `press` and `release` changed twice within the frame: a tap shorter than a
 * frame when it was up, a release and a new press when it was held.
 */
export interface TimelineEntry<B extends Bindings> {
  readonly frame: number
  readonly press?: ReadonlyArray<TimelineName<B>>
  readonly release?: ReadonlyArray<TimelineName<B>>
}

/**
 * What a timeline presses and releases: a button action, or one direction
 * of a vector action (`"move.right"`).
 */
export type TimelineName<B extends Bindings> = ButtonNames<B> | `${VectorNames<B>}.${Direction}`

/**
 * Input changes by snapshot index. Plain data, so it round-trips through
 * JSON; load it back with `parseTimeline`.
 */
export type Timeline<B extends Bindings> = ReadonlyArray<TimelineEntry<B>>

/**
 * Actions driven by a timeline instead of a host. The timeline names
 * actions, not keys, so `rebind` changes nothing.
 */
export interface Scripted<B extends Bindings> extends Actions<B> {
  /** Number of snapshots taken so far, which is the next frame index. */
  readonly frames: () => number
}

/**
 * Plays `timeline`: before the snapshot at index `frame`, every entry for
 * that frame is applied. Actions stay held from their press until their
 * release, like keys; pressing an action already held is not a new press.
 */
export const scripted = <const B extends Bindings>(bindings: B, timeline: Timeline<B>): Scripted<B> => {
  const names = Object.keys(flatten(bindings))
  const byFrame = new Map<number, Array<TimelineEntry<B>>>()
  for (const entry of timeline) {
    const entries = byFrame.get(entry.frame)
    if (entries) entries.push(entry)
    else byFrame.set(entry.frame, [entry])
  }
  const held = new Set<string>()
  let frame = 0
  let last: Readonly<Record<string, ActionState>> = {}
  const played: Scripted<B> & WithFlatStates & ReportsBoundKeys = {
    [boundKeys]: () => labelsOf(flatten(bindings)),
    snapshot() {
      const pressed = new Set<string>()
      const released = new Set<string>()
      for (const entry of byFrame.get(frame) ?? []) {
        const releases = new Set(entry.release ?? [])
        for (const name of entry.press ?? []) {
          if (held.has(name) && releases.has(name)) {
            // Released and pressed again within the frame.
            releases.delete(name)
            released.add(name)
            pressed.add(name)
            continue
          }
          // A press of a held action is not a new press, as with a live
          // keyboard's auto-repeat.
          if (!held.has(name)) pressed.add(name)
          held.add(name)
        }
        for (const name of releases) {
          if (held.delete(name)) released.add(name)
        }
      }
      frame += 1
      const states: Record<string, ActionState> = {}
      for (const name of names) {
        const isHeld = held.has(name)
        states[name] = { held: isHeld, pressed: pressed.has(name), released: released.has(name) && !isHeld }
      }
      last = states
      return assemble(bindings, (name) => states[name]!, anyUsed(states)) as Snapshot<B>
    },
    [flatStates]: () => last,
    // A timeline names actions, not keys, so new keys change nothing.
    rebind() {},
    dispose() {},
    frames: () => frame
  }
  return played
}

/**
 * Live actions that also record the timeline they produce.
 */
export interface Recording<B extends Bindings> extends Actions<B> {
  /** The recorded timeline; `scripted(bindings, timeline)` replays it exactly. */
  readonly timeline: () => Timeline<B>
}

/**
 * Wraps `actions` and records, for every snapshot, the actions pressed and
 * released since the previous one.
 */
export const recording = <B extends Bindings>(actions: Actions<B>): Recording<B> => {
  const entries: Array<TimelineEntry<B>> = []
  let wasHeld = new Set<TimelineName<B>>()
  let frame = 0
  const recorded: Recording<B> & WithFlatStates & ReportsBoundKeys = {
    [boundKeys]: () => (actions as ReportsBoundKeys)[boundKeys]?.() ?? [],
    snapshot() {
      const snapshot = actions.snapshot()
      // Each direction of a vector action, from the keyboard this wraps.
      const states = (actions as WithFlatStates)[flatStates]?.() ?? (snapshot.actions as Readonly<Record<string, ActionState>>)
      const press: Array<TimelineName<B>> = []
      const release: Array<TimelineName<B>> = []
      const held = new Set<TimelineName<B>>()
      for (const name of Object.keys(states) as Array<TimelineName<B>>) {
        const state = states[name]!
        if (state.held) held.add(name)
        if (state.pressed) press.push(name)
        // A press of an action held at the previous snapshot means it was released in between.
        if (state.released || (state.pressed && wasHeld.has(name))) release.push(name)
      }
      wasHeld = held
      if (press.length > 0 || release.length > 0) {
        entries.push({
          frame,
          ...(press.length > 0 ? { press } : {}),
          ...(release.length > 0 ? { release } : {})
        })
      }
      frame += 1
      return snapshot
    },
    [flatStates]: () => (actions as WithFlatStates)[flatStates]?.() ?? {},
    rebind(bindings) {
      actions.rebind(bindings)
    },
    dispose() {
      actions.dispose()
    },
    timeline: () => [...entries]
  }
  return recorded
}

/**
 * Why loaded data is not a timeline for the bindings. `path` points at the
 * offending value, for example `[3].press[0]`.
 */
export interface InvalidTimeline {
  readonly _tag: "InvalidTimeline"
  readonly path: string
  readonly message: string
}

/**
 * Validates untrusted data, such as a parsed JSON file, as a timeline for
 * `bindings`: an array of entries with a non-negative integer `frame` and
 * optional `press`/`release` arrays of bound action names (a vector action
 * by direction, `"move.right"`).
 */
export const parseTimeline = <const B extends Bindings>(
  bindings: B,
  data: unknown
): Result.Result<Timeline<B>, InvalidTimeline> => {
  const invalid = (path: string, message: string) => Result.failure<InvalidTimeline>({ _tag: "InvalidTimeline", path, message })
  if (!Array.isArray(data)) return invalid("", "expected an array of entries")
  const flat = flatten(bindings)
  const entries: Array<TimelineEntry<B>> = []
  for (let index = 0; index < data.length; index++) {
    const entry: unknown = data[index]
    const path = `[${index}]`
    if (typeof entry !== "object" || entry === null) return invalid(path, "expected an object")
    const { frame, press, release } = entry as { readonly frame?: unknown; readonly press?: unknown; readonly release?: unknown }
    if (typeof frame !== "number" || !Number.isInteger(frame) || frame < 0) {
      return invalid(`${path}.frame`, "expected a non-negative integer")
    }
    const actionsAt = (value: unknown, field: string): Result.Result<Array<TimelineName<B>> | undefined, InvalidTimeline> => {
      if (value === undefined) return Result.success(undefined)
      if (!Array.isArray(value)) return invalid(`${path}.${field}`, "expected an array of action names")
      const names: Array<TimelineName<B>> = []
      for (let offset = 0; offset < value.length; offset++) {
        const name: unknown = value[offset]
        if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(flat, name)) {
          return invalid(`${path}.${field}[${offset}]`, `expected one of ${Object.keys(flat).join(", ")}`)
        }
        names.push(name as TimelineName<B>)
      }
      return Result.success(names)
    }
    const pressed = actionsAt(press, "press")
    if (!pressed.ok) return pressed
    const released = actionsAt(release, "release")
    if (!released.ok) return released
    entries.push({
      frame,
      ...(pressed.value === undefined ? {} : { press: pressed.value }),
      ...(released.value === undefined ? {} : { release: released.value })
    })
  }
  return Result.success(entries)
}

/**
 * Why loaded data is not a rebinding for the bindings. `path` points at the
 * offending value, for example `jump[1]`.
 */
export interface InvalidRebinding {
  readonly _tag: "InvalidRebinding"
  readonly path: string
  readonly message: string
}

/**
 * Validates untrusted data, such as saved settings parsed from JSON, as new
 * keys for `bindings`: an object with exactly the same action names, each
 * mapped to a non-empty array of characters or `{ code }` physical keys
 * (for a vector action, an object with such keys for `up`, `down`, `left`,
 * and `right`, as `Keyboard.vector` saves).
 * Pass the result to {@link Actions.rebind}; on failure, keep the defaults.
 *
 * @example
 * ```ts
 * const saved = Keyboard.parseRebinding(bindings, JSON.parse(stored))
 * if (saved.ok) input.rebind(saved.value)
 * ```
 */
export const parseRebinding = <const B extends Bindings>(
  bindings: B,
  data: unknown
): Result.Result<Rebinding<B>, InvalidRebinding> => {
  const invalid = (path: string, message: string) => Result.failure<InvalidRebinding>({ _tag: "InvalidRebinding", path, message })
  if (typeof data !== "object" || data === null || Array.isArray(data)) return invalid("", "expected an object of action names")
  const fields = data as Readonly<Record<string, unknown>>
  const names = Object.keys(bindings)
  for (const name of Object.keys(fields)) {
    if (!names.includes(name)) return invalid(name, `unknown action, expected one of ${names.join(", ")}`)
  }
  const keysAt = (value: unknown, path: string): Result.Result<Keys, InvalidRebinding> => {
    if (!Array.isArray(value) || value.length === 0) return invalid(path, "expected a non-empty array of keys")
    const keys: Array<KeyBinding> = []
    for (let offset = 0; offset < value.length; offset++) {
      const key: unknown = value[offset]
      if (typeof key === "string" && key.length > 0) keys.push(key)
      else if (typeof key === "object" && key !== null && typeof (key as { readonly code?: unknown }).code === "string" && (key as PhysicalKey).code.length > 0) {
        keys.push({ code: (key as PhysicalKey).code })
      } else return invalid(`${path}[${offset}]`, "expected a key character or { code }")
    }
    return Result.success(keys as unknown as Keys)
  }
  const rebinding: Record<string, Keys | VectorBinding> = {}
  for (const name of names) {
    const value = fields[name]
    if (isVectorBinding(bindings[name])) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid(name, "expected { up, down, left, right } keys for a vector action")
      const parts: Partial<Record<Direction, Keys>> = {}
      for (const direction of directions) {
        const keys = keysAt((value as Readonly<Record<string, unknown>>)[direction], `${name}.${direction}`)
        if (!keys.ok) return keys
        parts[direction] = keys.value
      }
      rebinding[name] = vector(parts as Record<Direction, Keys>)
      continue
    }
    const keys = keysAt(value, name)
    if (!keys.ok) return keys
    rebinding[name] = keys.value
  }
  return Result.success(rebinding as unknown as Rebinding<B>)
}
