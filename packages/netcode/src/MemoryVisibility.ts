/**
 * A page a test hides and shows, for headless tests of hidden tabs.
 *
 * `make()` is a `Visibility` that starts shown; `hide()` and `show()` call
 * every listener at once, as the browser's `visibilitychange` does. A test
 * that hides a peer usually also stops calling its `advance`, as a browser
 * stops its frames.
 *
 * @module MemoryVisibility
 * @docGroup netcode
 *
 * @example
 * ```ts
 * // The test's own start: `Netcode.rollback(runtime, { ...options, hidden })` (see `Netcode`).
 * declare const startMatch: (hidden: Netcode.HiddenOptions) => void
 * // ---cut---
 * const visibility = MemoryVisibility.make()
 * startMatch({ visibility, afterMS: 10_000, then: "stall" })
 * visibility.hide()
 * ```
 */
import type * as Visibility from "./Visibility.ts"

/** A {@link Visibility.Visibility} the test drives. */
export interface MemoryVisibility extends Visibility.Visibility {
  /** Hides the page and tells every listener; does nothing while hidden. */
  readonly hide: () => void
  /** Shows the page and tells every listener; does nothing while shown. */
  readonly show: () => void
  /** How many listeners are subscribed: 0 once every session that used it ended. */
  readonly listeners: () => number
}

/** A shown page. */
export const make = (): MemoryVisibility => {
  let hidden = false
  const listeners = new Set<(hidden: boolean) => void>()
  const set = (next: boolean): void => {
    if (hidden === next) return
    hidden = next
    for (const listener of [...listeners]) listener(next)
  }
  return {
    hidden: () => hidden,
    subscribe: (listener) => {
      // Each subscription removes only itself, even when the same function subscribes twice.
      const own = (value: boolean): void => listener(value)
      listeners.add(own)
      return () => {
        listeners.delete(own)
      }
    },
    hide: () => set(true),
    show: () => set(false),
    listeners: () => listeners.size
  }
}
