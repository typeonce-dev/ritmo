/**
 * Rewindable service carriers and what the runtime does with them.
 *
 * A carrier is a frozen object whose `current` is a getter over a slot only
 * this module writes: systems hold the carrier (it is the provided service),
 * so after a rewind they read the restored value through the same object.
 */
import type { Result } from "./result.ts"

interface Slot {
  current: unknown
  readonly save: (value: unknown) => unknown
  readonly restore: (saved: unknown) => Result<unknown, unknown>
}

const slots = new WeakMap<object, Slot>()

/** A new carrier over `current`, saved and restored by `save` and `restore`. */
export const make = (
  current: unknown,
  save: (value: never) => unknown,
  restore: (saved: never) => Result<unknown, unknown>
): object => {
  const slot: Slot = { current, save: save as Slot["save"], restore: restore as Slot["restore"] }
  const carrier = Object.freeze({
    get current() {
      return slot.current
    },
    save,
    restore
  })
  slots.set(carrier, slot)
  return carrier
}

/** Whether `value` is a carrier `make` built. */
export const isRewindable = (value: unknown): boolean =>
  typeof value === "object" && value !== null && slots.has(value)

/** One provided rewindable service, by the name it was provided under. */
export interface Provided {
  readonly name: string
  readonly slot: Slot
}

/** The rewindable services among `services`, or `undefined` when there is none (checkpoints then save nothing more). */
export const collect = (services: Readonly<Record<string, unknown>>): ReadonlyArray<Provided> | undefined => {
  const provided: Array<Provided> = []
  const seen = new Set<Slot>()
  for (const [name, value] of Object.entries(services)) {
    const slot = typeof value === "object" && value !== null ? slots.get(value) : undefined
    // One carrier provided under two names is saved and restored once.
    if (slot === undefined || seen.has(slot)) continue
    seen.add(slot)
    provided.push({ name, slot })
  }
  return provided.length === 0 ? undefined : provided
}

/** Each service's saved state now, in `provided` order. */
export const saveAll = (provided: ReadonlyArray<Provided>): ReadonlyArray<unknown> =>
  provided.map(({ slot }) => slot.save(slot.current))

/**
 * Restores every service from `saved` (from `saveAll` over the same list).
 * Every restore runs before any `current` changes: on the first failure,
 * nothing is changed and the failing service's name and error come back.
 */
export const restoreAll = (
  provided: ReadonlyArray<Provided>,
  saved: ReadonlyArray<unknown>
): { readonly service: string; readonly error: unknown } | undefined => {
  const restored: Array<unknown> = []
  for (let index = 0; index < provided.length; index++) {
    const { name, slot } = provided[index]!
    const result = slot.restore(saved[index])
    if (!result.ok) return { service: name, error: result.error }
    restored.push(result.value)
  }
  for (let index = 0; index < provided.length; index++) provided[index]!.slot.current = restored[index]
  return undefined
}
