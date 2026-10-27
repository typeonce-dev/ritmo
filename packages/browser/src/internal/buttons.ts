import * as Result from "@typeonce/ritmo/Result"

import type { ActionState } from "./state.ts"
import { directionName, directions, isVectorBinding, zero } from "./vectors.ts"
import type { Direction, Vector } from "./vectors.ts"

const idleState: ActionState = { held: false, pressed: false, released: false }

/** Action name to the buttons that trigger it, for a device with named buttons. */
type ButtonBindings<Button extends string> = Readonly<Record<string, readonly [Button, ...Array<Button>]>>

/**
 * The held buttons, the bound actions, and the edges since the previous
 * take, shared by devices with named buttons (`Gamepad`, `Pointer`) and by
 * their live and scripted forms, so all of them build snapshots the same way.
 */
export const buttonTracker = <Button extends string, B extends ButtonBindings<Button>>(
  buttonNames: ReadonlyArray<Button>,
  initial: B
) => {
  // Fixed at creation: a rebind swaps buttons, never the actions.
  const names = Object.keys(initial) as Array<keyof B & string>
  let bindings: Readonly<Record<keyof B, ReadonlyArray<Button>>> = initial
  const actionsByButton = new Map<Button, Array<keyof B & string>>()
  const index = (): void => {
    actionsByButton.clear()
    for (const name of names) {
      for (const button of bindings[name]) {
        const bound = actionsByButton.get(button)
        if (bound) bound.push(name)
        else actionsByButton.set(button, [name])
      }
    }
  }
  index()
  const held = new Set<Button>()
  const pressed = new Set<Button>()
  const released = new Set<Button>()
  /**
   * Each held button and the actions it holds: those bound to it when it
   * went down that are still bound to it.
   */
  const holding = new Map<Button, Set<keyof B & string>>()
  const pressedActions = new Set<keyof B>()
  const releasedActions = new Set<keyof B>()
  const isHeld = (name: keyof B & string): boolean => bindings[name].some((button) => holding.get(button)?.has(name) === true)
  const up = (button: Button): void => {
    if (!held.delete(button)) return
    released.add(button)
    for (const name of holding.get(button) ?? []) releasedActions.add(name)
    holding.delete(button)
  }
  return {
    held,
    down(button: Button) {
      if (held.has(button)) return
      held.add(button)
      pressed.add(button)
      const bound = actionsByButton.get(button) ?? []
      holding.set(button, new Set(bound))
      for (const name of bound) pressedActions.add(name)
    },
    up,
    upAll() {
      for (const button of [...held]) up(button)
    },
    rebind(next: Readonly<Record<keyof B, ReadonlyArray<Button>>>) {
      const before = names.filter(isHeld)
      bindings = next
      index()
      // A held button keeps only the actions still bound to it; new ones wait for a fresh press.
      for (const [button, actions] of holding) {
        const bound = actionsByButton.get(button) ?? []
        for (const name of actions) if (!bound.includes(name)) actions.delete(name)
      }
      for (const name of before) if (!isHeld(name)) releasedActions.add(name)
    },
    /** The buttons and actions since the previous take; starts a new press/release window. */
    take(): { readonly actions: Record<keyof B, ActionState>; readonly buttons: Record<Button, ActionState> } {
      const buttons = {} as Record<Button, ActionState>
      for (const name of buttonNames) {
        const isDown = held.has(name)
        buttons[name] = isDown || pressed.has(name) || released.has(name)
          ? { held: isDown, pressed: pressed.has(name), released: released.has(name) && !isDown }
          : idleState
      }
      const actions = {} as Record<keyof B, ActionState>
      for (const name of names) {
        const isDown = isHeld(name)
        const isPressed = pressedActions.has(name)
        const isReleased = releasedActions.has(name) && !isDown
        actions[name] = isDown || isPressed || isReleased ? { held: isDown, pressed: isPressed, released: isReleased } : idleState
      }
      // V8 allocates a new table on every clear(), even of an empty set, and this runs every frame.
      if (pressed.size > 0) pressed.clear()
      if (released.size > 0) released.clear()
      if (pressedActions.size > 0) pressedActions.clear()
      if (releasedActions.size > 0) releasedActions.clear()
      return { actions, buttons }
    }
  }
}

/** Every button idle, by name. */
export const idleButtons = <Button extends string>(buttonNames: ReadonlyArray<Button>): Record<Button, ActionState> => {
  const buttons = {} as Record<Button, ActionState>
  for (const name of buttonNames) buttons[name] = idleState
  return buttons
}

/** Every button action of `bindings` idle (vector actions are in {@link idleVectors}). */
export const idleActions = <B extends object>(bindings: B): Record<keyof B, ActionState> => {
  const actions = {} as Record<keyof B, ActionState>
  for (const [name, entry] of Object.entries(bindings)) if (!isVectorBinding(entry)) actions[name as keyof B] = idleState
  return actions
}

/** Every vector action of `bindings` at rest. */
export const idleVectors = (bindings: object): Record<string, Vector> => {
  const vectors: Record<string, Vector> = {}
  for (const [name, entry] of Object.entries(bindings)) if (isVectorBinding(entry)) vectors[name] = zero
  return vectors
}

/** A vector binding's digital part: buttons for the four directions, or none. */
interface DigitalVector<Button extends string> {
  readonly _tag: "Vector"
  readonly up?: ReadonlyArray<Button>
  readonly down?: ReadonlyArray<Button>
  readonly left?: ReadonlyArray<Button>
  readonly right?: ReadonlyArray<Button>
}

/**
 * Each action's buttons for the button tracker, with the digital part of
 * every vector action split into its four directions (`move.up`, ...).
 */
export const flattenButtons = <Button extends string>(bindings: object): Record<string, readonly [Button, ...Array<Button>]> => {
  const flat: Record<string, readonly [Button, ...Array<Button>]> = {}
  for (const [name, entry] of Object.entries(bindings)) {
    if (isVectorBinding(entry)) {
      const vector = entry as DigitalVector<Button>
      // All four, empty when unbound (a stick-only vector), so the tracker's
      // names stay the same whichever way a rebind binds the vector.
      for (const direction of directions) {
        flat[directionName(name, direction)] = (vector[direction] ?? []) as unknown as readonly [Button, ...Array<Button>]
      }
    } else flat[name] = entry as readonly [Button, ...Array<Button>]
  }
  return flat
}

/** Splits taken flat actions into the button actions of `bindings`, and whether each vector direction is held. */
export const splitActions = (
  bindings: object,
  taken: Readonly<Record<string, ActionState>>
): { readonly actions: Record<string, ActionState>; readonly held: (vector: string, direction: Direction) => boolean } => {
  const actions: Record<string, ActionState> = {}
  for (const [name, entry] of Object.entries(bindings)) if (!isVectorBinding(entry)) actions[name] = taken[name]!
  return { actions, held: (vector, direction) => taken[directionName(vector, direction)]?.held === true }
}

/** Why loaded data is not a rebinding; the devices export it under their own name. */
export interface InvalidRebinding {
  readonly _tag: "InvalidRebinding"
  readonly path: string
  readonly message: string
}

/**
 * Validates `data` as new buttons for exactly the actions of `bindings`:
 * an object with the same action names, each a non-empty array of button
 * names.
 */
export const parseButtonRebinding = <Button extends string>(
  buttonNames: ReadonlyArray<Button>,
  bindings: object,
  data: unknown,
  sticks: ReadonlyArray<string> = []
): Result.Result<Readonly<Record<string, unknown>>, InvalidRebinding> => {
  const invalid = (path: string, message: string) => Result.failure<InvalidRebinding>({ _tag: "InvalidRebinding", path, message })
  if (typeof data !== "object" || data === null || Array.isArray(data)) return invalid("", "expected an object of action names")
  const fields = data as Readonly<Record<string, unknown>>
  const names = Object.keys(bindings)
  for (const name of Object.keys(fields)) {
    if (!names.includes(name)) return invalid(name, `unknown action, expected one of ${names.join(", ")}`)
  }
  const known: ReadonlySet<string> = new Set(buttonNames)
  const buttonsAt = (value: unknown, path: string): Result.Result<ReadonlyArray<Button>, InvalidRebinding> => {
    if (!Array.isArray(value) || value.length === 0) return invalid(path, "expected a non-empty array of button names")
    for (let offset = 0; offset < value.length; offset++) {
      if (!known.has(value[offset])) return invalid(`${path}[${offset}]`, `expected one of ${buttonNames.join(", ")}`)
    }
    return Result.success([...value])
  }
  const rebinding: Record<string, unknown> = {}
  for (const name of names) {
    const value = fields[name]
    if (isVectorBinding((bindings as Readonly<Record<string, unknown>>)[name])) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return invalid(name, "expected { stick } and/or { up, down, left, right } buttons for a vector action")
      }
      const parts = value as Readonly<Record<string, unknown>>
      const vector: Record<string, unknown> = { _tag: "Vector" }
      if (parts["stick"] !== undefined) {
        if (typeof parts["stick"] !== "string" || !sticks.includes(parts["stick"])) return invalid(`${name}.stick`, `expected one of ${sticks.join(", ")}`)
        vector["stick"] = parts["stick"]
      }
      const given = directions.filter((direction) => parts[direction] !== undefined)
      if (given.length > 0) {
        for (const direction of directions) {
          const buttons = buttonsAt(parts[direction], `${name}.${direction}`)
          if (!buttons.ok) return buttons
          vector[direction] = buttons.value
        }
      } else if (vector["stick"] === undefined) return invalid(name, "expected a stick or buttons for up, down, left, and right")
      rebinding[name] = vector
      continue
    }
    const buttons = buttonsAt(value, name)
    if (!buttons.ok) return buttons
    rebinding[name] = buttons.value
  }
  return Result.success(rebinding)
}
