/**
 * The Page Visibility API as a netcode `Visibility`
 * (`@typeonce/ritmo-netcode`): whether this tab is hidden, and a listener
 * on `visibilitychange`.
 *
 * A hidden tab's animation frames stop. Pass this to a networked session's
 * `hidden` option, so it tells the other peers instead of going silent. The
 * document is passed in, so nothing reads a global. Pausing a single-player
 * game on a hidden tab is the game's own policy: read `hidden()` or
 * `subscribe` in host code.
 *
 * @example
 * ```ts
 * const hidden: Netcode.HiddenOptions = { visibility: BrowserVisibility.make(document), afterMS: 30_000, then: "resync-on-return" }
 * // The session's other options as usual: Netcode.rollback(runtime, { ...options, hidden })
 * ```
 *
 * @module BrowserVisibility
 * @docGroup browser
 */

/** What the visibility needs from the document. */
export interface Host {
  readonly visibilityState: string
  addEventListener(type: "visibilitychange", listener: () => void): void
  removeEventListener(type: "visibilitychange", listener: () => void): void
}

/**
 * The document's visibility: `hidden()` reads `visibilityState`, and
 * `subscribe` calls its listener with `true` when the tab hides and `false`
 * when it shows, until the returned function removes it.
 */
export const make = (host: Host): {
  readonly hidden: () => boolean
  readonly subscribe: (listener: (hidden: boolean) => void) => () => void
} => {
  const hidden = (): boolean => host.visibilityState === "hidden"
  return {
    hidden,
    subscribe: (listener) => {
      const changed = (): void => listener(hidden())
      host.addEventListener("visibilitychange", changed)
      return () => host.removeEventListener("visibilitychange", changed)
    }
  }
}
