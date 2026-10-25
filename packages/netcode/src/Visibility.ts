/**
 * Whether this peer's page is hidden: a contract, implemented per platform.
 *
 * A browser throttles a hidden tab: its animation frames stop, so its
 * session sends nothing, and after `timeoutMS` the other peers would end
 * the match. Given a `Visibility` (`Netcode.rollback`'s `hidden` option),
 * a session hears the moment its page hides, tells the other peers right
 * away, and they apply the declared policy instead.
 *
 * - `BrowserVisibility.make(document)` in `@typeonce/ritmo-browser`: the
 *   Page Visibility API.
 * - `MemoryVisibility.make()`: a page a test hides and shows.
 * - Any other platform (a native shell going to the background): implement
 *   the two methods.
 *
 * @module Visibility
 * @docGroup netcode
 *
 * @example
 * ```ts
 * const visibility: Visibility.Visibility = {
 *   hidden: () => app.inBackground,
 *   subscribe: (listener) => app.onBackground(listener)
 * }
 * ```
 */

/** Tells when this page hides and shows again. */
export interface Visibility {
  /** Whether the page is hidden now. */
  readonly hidden: () => boolean
  /**
   * Calls `listener` each time the page hides (`true`) or shows (`false`),
   * as it happens, even when the page's frames have stopped. Returns the
   * function that removes the listener: a session calls it once it ends.
   */
  readonly subscribe: (listener: (hidden: boolean) => void) => () => void
}
