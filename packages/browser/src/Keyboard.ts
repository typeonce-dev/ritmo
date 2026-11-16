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
 * its action. Keys that type the same character (both Shift keys, a digit on
 * the row and on the numpad) are one key to a character binding: it is
 * pressed when the first goes down and released when the last comes up.
 *
 * Browser shortcuts are left to the browser: a key pressed with Cmd held, or
 * with Ctrl held, presses no action and is not `preventDefault`-ed, so Ctrl+R
 * still reloads and Ctrl+F still finds while R and F are bound. AltGr reports
 * Ctrl and Alt together and types characters on many layouts, so a key
 * pressed with both is not a shortcut. A game that binds Control or Meta to
 * an action (`"Control"`, `Keyboard.code("ControlLeft")`, ...) keeps every
 * key pressed with them instead, for as long as its bindings hold one; some
 * combinations still never reach the page (Ctrl+W / Cmd+W, Ctrl+T / Cmd+T,
 * Cmd+Q). macOS sends no keyup for a key released while Cmd is down, so
 * Cmd's own release lets go of every held key but the modifiers. A key still
 * down after that, or after a window blur, is pressed again at its next
 * auto-repeat.
 *
 * Keys the page is using are left to the page: a key that goes down in a
 * form field (`<input>` of any type, `<textarea>`, `<select>`,
 * contenteditable), on a control the player reached by keyboard (Tab to a
 * button, link, tab, or any focusable element: the browser shows it with
 * `:focus-visible`), inside an open modal dialog (`<dialog>` opened with
 * `showModal()`, or `aria-modal="true"`), or that a listener nearer the
 * target already handled with `preventDefault()` (a menu's arrows, a
 * slider's keys) presses no action and is not `preventDefault`-ed. So a name
 * field receives "wasd" and the player does not move, Enter and Space press
 * a focused button, and Escape closes a modal `<dialog>`. A control the
 * player clicked with the mouse keeps focus but not the keys: the game keeps
 * playing, and Space does not press it again, with no `tabIndex = -1` or
 * `blur()` in the game. A focused `<canvas>`, or the element passed as the
 * host, is the game, not page UI. Releases are always processed, so a key
 * held before focus moved still releases its action. With `window` as the
 * host this needs no setup; see {@link KeyEvent} for the exact rule.
 *
 * @module Keyboard
 * @docGroup browser
 *
 * @example
 * ```ts
 * declare const jump: () => void
 * // ---cut---
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
 * declare const saved: string
 * // ---cut---
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
import { digital, directionName, directions, isVectorBinding } from "./internal/vectors.ts"
import type { ActionState } from "./internal/state.ts"
import type { Direction, Vector } from "./internal/vectors.ts"

export type { Direction }

/**
 * The subset of `KeyboardEvent` the module reads. `code` (the physical key),
 * the modifiers, `defaultPrevented`, and `target` (the focused element the
 * key went down in) are optional so simple test hosts can omit them;
 * browsers always provide them. `ctrlKey` and `metaKey` mark a browser
 * shortcut, which {@link actions} leaves to the browser, and `altKey` tells
 * AltGr (Ctrl and Alt together) from Ctrl.
 *
 * {@link actions} and {@link presses} leave a key to the page when any of
 * these holds:
 *
 * - `defaultPrevented` is `true` because a listener nearer the target (a
 *   roving-focus group's arrows, a custom slider, a menu) handled it, not
 *   because another `Keyboard.actions` on the same host did;
 * - the target is a form field: its `tagName` is `INPUT` (any type,
 *   checkboxes and buttons included), `TEXTAREA`, or `SELECT`, or its
 *   `isContentEditable` is `true`;
 * - the target is inside an open modal dialog: `closest` finds a
 *   `dialog:modal` (opened with `showModal()`) or an `[aria-modal="true"]`
 *   element, however the dialog was opened;
 * - the target took focus by keyboard: it matched `:focus-visible` when its
 *   `focusin` reached the host, and it is not a `<canvas>` or the host
 *   itself (the game's own surface).
 *
 * Focus is judged when it arrives because browsers disagree later: Chromium
 * turns `:focus-visible` on for a clicked button at the first key the player
 * presses, so a check at keydown would hand Space back to a "Mute" button
 * clicked minutes earlier. A focus a script moves (`element.focus()`) counts
 * as by keyboard after the player last used the keyboard in Chromium and
 * Safari, never in Firefox; a dialog's own focus is covered by the modal
 * rule in all three.
 *
 * The target is read by shape, not `instanceof`, so it works across
 * iframes, and a test host types into a field by passing
 * `{ tagName: "INPUT" }` or `{ isContentEditable: true }`, and focuses a
 * control by keyboard by sending `focusin` with a target whose
 * `matches(":focus-visible")` returns `true`.
 */
export interface KeyEvent {
  readonly key: string
  readonly code?: string
  readonly repeat: boolean
  readonly ctrlKey?: boolean
  readonly metaKey?: boolean
  readonly altKey?: boolean
  readonly defaultPrevented?: boolean
  readonly target?: object | null
  preventDefault(): void
}

/**
 * The subset of the `focusin` event the module reads: the element that took
 * focus, read by shape like {@link KeyEvent}'s target.
 */
export interface FocusInEvent {
  readonly target?: object | null
}

/** Every action that is not in use shares this state, so a snapshot of an idle keyboard allocates no states. */
const idleState: ActionState = { held: false, pressed: false, released: false }

const editableTags: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA", "SELECT"])

/** The members of an element the module reads, all optional: a test host passes plain objects. */
interface TargetShape {
  readonly tagName?: unknown
  readonly isContentEditable?: unknown
  readonly matches?: unknown
  readonly closest?: unknown
}

/** Whether a key event's target is a form field, by the rule on {@link KeyEvent}. */
const isEditableTarget = (target: object): boolean => {
  const { tagName, isContentEditable } = target as TargetShape
  return isContentEditable === true || (typeof tagName === "string" && editableTags.has(tagName.toUpperCase()))
}

/** `target.matches(selector)`, false for a target without it or a selector the browser does not know. */
const matchesSelector = (target: object, selector: string): boolean => {
  const { matches } = target as TargetShape
  if (typeof matches !== "function") return false
  try {
    return (matches as (selector: string) => unknown).call(target, selector) === true
  } catch {
    return false
  }
}

/** Whether `target.closest(selector)` finds an element, false where it cannot ask. */
const hasAncestor = (target: object, selector: string): boolean => {
  const { closest } = target as TargetShape
  if (typeof closest !== "function") return false
  try {
    const found: unknown = (closest as (selector: string) => unknown).call(target, selector)
    return found !== null && found !== undefined
  } catch {
    return false
  }
}

/** Whether the target is inside an open modal dialog. `:modal` is asked of dialogs only, since a fullscreen element can match it too. */
const isInsideModal = (target: object): boolean =>
  hasAncestor(target, "[aria-modal=\"true\"]") || hasAncestor(target, "dialog:modal")

/**
 * The key events a `Keyboard.actions` device prevented: another device on
 * the same host sees them as `defaultPrevented`, and they are still the game's.
 */
const preventedByKeyboard = new WeakSet()

/**
 * Tracks which element took focus by keyboard on `host`, and answers
 * whether a key belongs to the page by the rule on {@link KeyEvent}.
 */
const pageKeys = (host: KeyboardHost): { readonly owns: (event: KeyEvent) => boolean; readonly dispose: () => void } => {
  // The element that last took focus while it matched `:focus-visible`, read
  // at `focusin` because Chromium turns it on for a clicked control at the next key.
  let keyboardFocused: object | null = null
  const onFocusIn = (event: FocusInEvent): void => {
    const target = event.target ?? null
    keyboardFocused = target !== null && matchesSelector(target, ":focus-visible") ? target : null
  }
  host.addEventListener("focusin", onFocusIn)
  const isGameSurface = (target: object): boolean => {
    const { tagName } = target as TargetShape
    return target === host || (typeof tagName === "string" && tagName.toUpperCase() === "CANVAS")
  }
  return {
    owns(event) {
      if (event.defaultPrevented === true && !preventedByKeyboard.has(event)) return true
      const target = event.target ?? null
      if (target === null) return false
      return isEditableTarget(target) || isInsideModal(target) || (target === keyboardFocused && !isGameSurface(target))
    },
    dispose() {
      host.removeEventListener("focusin", onFocusIn)
    }
  }
}

const modifierKeys: ReadonlySet<string> = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta"])
const modifierCodes: ReadonlySet<string> = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"])

/**
 * Whether a key goes down as a browser shortcut: with Cmd, or with Ctrl
 * without Alt (AltGr reports both and types characters), and not a
 * modifier itself.
 */
const isShortcut = (event: KeyEvent): boolean =>
  (event.metaKey === true || (event.ctrlKey === true && event.altKey !== true)) && !modifierKeys.has(event.key)

const isMeta = (event: KeyEvent): boolean => event.key === "Meta" || event.code === "MetaLeft" || event.code === "MetaRight"

/**
 * The event target the module listens on, usually `window`. `focusin` tells
 * which control the player reached by keyboard (see {@link KeyEvent}); a
 * test host that never sends it has no such control.
 */
export interface KeyboardHost {
  addEventListener(type: "keydown" | "keyup", listener: (event: KeyEvent) => void): void
  addEventListener(type: "focusin", listener: (event: FocusInEvent) => void): void
  addEventListener(type: "blur", listener: () => void): void
  removeEventListener(type: "keydown" | "keyup", listener: (event: KeyEvent) => void): void
  removeEventListener(type: "focusin", listener: (event: FocusInEvent) => void): void
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
 * Option held on macOS, W types "∑"; with Shift, 1 types "!"). A character
 * binding matches every key that types it: `"Shift"` is both Shift keys,
 * held while either is down, and `"1"` is the digit row and the numpad;
 * bind `Keyboard.code("ShiftLeft")` for one of them.
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
   * the page and a button clicked with the mouse, which keeps focus, is not
   * pressed again by Space or Enter. Defaults to `true`. With `false`, every
   * key the game takes also does what the page does with it (Space presses
   * that clicked button and scrolls); which keys the game takes does not change.
   */
  readonly preventDefault?: boolean
}

/**
 * A snapshot with every action idle, for initializing an input resource
 * before the first capture.
 */
export const idle = <const B extends Bindings>(bindings: B): Snapshot<B> =>
  assemble(bindings, () => idleState, false) as Snapshot<B>

/** Each action's keys, with every vector action split into its four directions (`move.up`, ...). */
const flatten = (bindings: Bindings): Readonly<Record<string, Keys>> => {
  const flat: Record<string, Keys> = {}
  for (const [name, entry] of Object.entries(bindings)) {
    if (isVectorBinding(entry)) {
      for (const direction of directions) flat[directionName(name, direction)] = entry[direction]
    } else flat[name] = entry
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
  return { actions, vectors, used }
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

const modifierTokens: ReadonlySet<string> = new Set([...[...modifierKeys].map(keyToken), ...[...modifierCodes].map(codeToken)])

/** The tokens of Ctrl and Cmd: a game that binds one keeps the keys pressed with them. */
const shortcutModifierTokens = [
  keyToken("Control"),
  keyToken("Meta"),
  codeToken("ControlLeft"),
  codeToken("ControlRight"),
  codeToken("MetaLeft"),
  codeToken("MetaRight")
]

/**
 * Starts tracking bound keys on `host`, usually `window`, until `dispose()`.
 * When the window loses focus every held action is released. A key the page
 * is using (a form field, a control reached by keyboard, an open modal
 * dialog, a key a widget already handled; see {@link KeyEvent}) is left to
 * the page, and a browser shortcut (a key pressed with Cmd or Ctrl, unless
 * the bindings use Control or Meta) to the browser: it presses no action and
 * is not `preventDefault`-ed. Use it for every key the host reacts to,
 * one-shot keys too (pause on Escape, mute on M: read their `pressed` edge
 * in the snapshot), instead of a `keydown` listener on `window` that calls
 * `preventDefault()` and so takes Enter and Space from a focused button.
 * Binding Tab keeps a keyboard player from moving focus to the page's
 * controls, so a page with controls leaves it unbound. Each call is
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
  // Off while the bindings use Ctrl or Cmd as a button: then every key pressed with them is the game's.
  let leavesShortcuts = true
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
    leavesShortcuts = !shortcutModifierTokens.some((token) => actionsByToken.has(token))
  }
  index()
  const page = pageKeys(host)

  /**
   * Each held token and the actions it holds: those bound to it when it went
   * down that are still bound to it. A token stays here while held even if a
   * rebind unbound it, so its release is still seen.
   */
  const heldTokens = new Map<string, Set<string>>()
  /**
   * The character token each physical key produced when it went down, so its
   * release matches even if a modifier changed the character meanwhile
   * (W pressed, Option pressed, W released as "∑"). It also holds the keys
   * known to be down, form fields and shortcuts included: their repeats
   * press nothing.
   */
  const keyTokenByCode = new Map<string, string>()
  /**
   * The physical keys holding each held character token, so a character two
   * keys type (both Shifts, a digit on the row and on the numpad) stays held
   * until the last of them comes up. A token held through a host that sends
   * no `code` has no entry, and its first release lets go of it.
   */
  const codesByToken = new Map<string, Set<string>>()
  const pressed = new Set<string>()
  const released = new Set<string>()

  const release = (token: string): void => {
    const holding = heldTokens.get(token)
    if (!holding) return
    heldTokens.delete(token)
    codesByToken.delete(token)
    for (const name of holding) released.add(name)
  }

  /** Lets go of `code`'s hold on a character token, releasing it when no other key holds it. */
  const letGo = (token: string, code: string): void => {
    const codes = codesByToken.get(token)
    if (codes === undefined || !codes.delete(code) || codes.size > 0) return
    release(token)
  }

  const onKeyDown = (event: KeyEvent): void => {
    const tokens = [keyToken(event.key)]
    // A repeat of a key known to be down presses nothing; one whose release
    // was missed (a blur, or Cmd on macOS) presses it again. Without `code`,
    // a repeat presses any key that is not held.
    const known = event.code !== undefined && keyTokenByCode.has(event.code)
    if (event.code !== undefined) {
      if (!event.repeat || !known) {
        // A new press: the key went up unseen if it was known down, so it no
        // longer holds what it typed then, and its release matches what it types now.
        const before = keyTokenByCode.get(event.code)
        if (before !== undefined && before !== tokens[0]) letGo(before, event.code)
        keyTokenByCode.set(event.code, tokens[0]!)
      }
      tokens.push(codeToken(event.code))
    }
    // A key the page is using belongs to the page; a shortcut belongs to the
    // browser. Their releases are still processed by `onKeyUp`.
    if (page.owns(event) || (leavesShortcuts && isShortcut(event))) return
    let handled = false
    for (const token of tokens) {
      const bound = actionsByToken.get(token)
      if (!bound) continue
      handled = true
      if (event.repeat && known) continue
      // Another key typing the same character joins its hold: one press for both.
      if (event.code !== undefined && token === tokens[0]) {
        const codes = codesByToken.get(token)
        if (codes) codes.add(event.code)
        else if (!heldTokens.has(token)) codesByToken.set(token, new Set([event.code]))
      }
      if (heldTokens.has(token)) continue
      heldTokens.set(token, new Set(bound))
      for (const name of bound) pressed.add(name)
    }
    if (handled && preventDefault) {
      event.preventDefault()
      preventedByKeyboard.add(event)
    }
  }

  // Releases are processed wherever the key was released, form fields and
  // focused controls included, so a key held before focus moved still releases.
  const onKeyUp = (event: KeyEvent): void => {
    const character = event.code === undefined ? keyToken(event.key) : keyTokenByCode.get(event.code) ?? keyToken(event.key)
    if (event.code === undefined || !codesByToken.has(character)) release(character)
    else letGo(character, event.code)
    if (event.code !== undefined) {
      keyTokenByCode.delete(event.code)
      release(codeToken(event.code))
    }
    // macOS sends no keyup for a key released while Cmd is down: Cmd's own
    // release lets go of every key but the modifiers, which do get theirs.
    if (!isMeta(event)) return
    for (const token of heldTokens.keys()) if (!modifierTokens.has(token)) release(token)
    for (const code of keyTokenByCode.keys()) if (!modifierCodes.has(code)) keyTokenByCode.delete(code)
  }

  const onBlur = (): void => {
    for (const holding of heldTokens.values()) {
      for (const name of holding) released.add(name)
    }
    heldTokens.clear()
    codesByToken.clear()
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
        const isPressed = pressed.has(name)
        const isReleased = released.has(name) && !held
        states[name] = held || isPressed || isReleased ? { held, pressed: isPressed, released: isReleased } : idleState
      }
      // V8 allocates a new table on every clear(), even of an empty set, and this runs every frame.
      if (pressed.size > 0) pressed.clear()
      if (released.size > 0) released.clear()
      last = states
      return assemble(initial, (name) => states[name]!, anyUsed(states)) as Snapshot<B>
    },
    [flatStates]: () => last,
    rebind(next) {
      const before = names.filter(isHeld)
      bindings = flatten(next)
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
      page.dispose()
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
  /** Removes the event listeners. */
  dispose(): void
}

/**
 * Starts collecting every key press on `host`, whatever the bindings, for a
 * settings screen that waits for the key to bind. Use {@link actions} for
 * gameplay. It never calls `preventDefault()`, and skips the keys the page
 * is using by the same rule as {@link actions} (see {@link KeyEvent}: a
 * form field, a control reached by keyboard, an open modal dialog, a key a
 * widget handled) and browser shortcuts (a key pressed with Cmd or Ctrl), so
 * Ctrl+R on the settings screen binds nothing; Control and Meta pressed
 * alone are offered. For "press any key" on a title or a cutscene, it is the
 * host's listener: it leaves Enter on a focused button to the button.
 *
 * @example
 * ```ts
 * const input = Keyboard.actions(window, bindings)
 * declare const current: Keyboard.Rebinding<typeof bindings>
 * // ---cut---
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
  const page = pageKeys(host)
  const onKeyDown = (event: KeyEvent): void => {
    if (event.repeat || page.owns(event) || isShortcut(event)) return
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
      page.dispose()
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
      const states = (actions as WithFlatStates)[flatStates]?.() ?? snapshot.actions
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
 * const input = Keyboard.actions(window, bindings)
 * declare const stored: string
 * // ---cut---
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
