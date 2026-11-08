/**
 * The browser's monotonic clock as a core `HostClock`.
 *
 * `window.performance.now()` never goes backwards, unlike `Date.now`
 * (`HostClock.standard`). The window is passed in, so nothing reads a global.
 *
 * @example
 * ```ts
 * // The handle in development only: a debug runtime freezes every value it is handed, so it costs each frame.
 * const runtime = Game.Runtime.make({
 *   services,
 *   debug: import.meta.env.DEV ? { hostClock: BrowserHostClock.make(window) } : undefined
 * }).value
 * ```
 *
 * @module BrowserHostClock
 */
import type { HostClock } from "@typeonce/ritmo"

/** What the clock needs from the window. */
export interface Host {
  readonly performance: { readonly now: () => number }
}

/** A host clock reading `host.performance.now()`. */
export const make = (host: Host): HostClock.HostClock => ({ now: () => host.performance.now() })
