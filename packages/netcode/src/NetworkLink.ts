/**
 * The transport a networked session sends its messages over: a contract,
 * implemented per transport.
 *
 * A link moves text between this peer and the others: one link per remote
 * peer (a mesh), or one link to a relay server that forwards every message
 * to every other peer. Every message names the seat it comes from, so a
 * session does not care which. The session owns what the text says (inputs,
 * checksums, saves); a link only carries it, in any order, and may lose
 * some: sessions repeat what was not acknowledged.
 *
 * Opening a connection, signaling, retrying, and reconnecting belong to the
 * game, before and around the link: an adapter wraps a connection that is
 * already made.
 *
 * - `MemoryNetworkLink.make(...)`: peers in one process, with seeded
 *   latency, jitter, and loss, for headless tests.
 * - `WebSocketNetworkLink.make(socket)`: a WebSocket to a relay server, in
 *   the browser, Node, Deno, or Bun.
 * - `WebRtcNetworkLink.make(channel)`: a WebRTC data channel to one peer.
 * - Any other transport, such as an Effect `Socket`: implement the three
 *   methods.
 *
 * @module NetworkLink
 * @docGroup netcode
 *
 * @example
 * ```ts
 * declare const transport: { readonly open: boolean; write(message: string): void; drain(): ReadonlyArray<string> }
 * // ---cut---
 * // A link over a transport the game already opened.
 * const link: NetworkLink.NetworkLink = {
 *   send: (message) => transport.write(message),
 *   receive: () => transport.drain(),
 *   status: () => transport.open ? NetworkLink.open : NetworkLink.closed("the server went away")
 * }
 * ```
 */

/** The link is connected: `send` delivers, eventually. */
export interface Open {
  readonly _tag: "Open"
}

/** The link will deliver nothing more: the session that reads it fails with `Disconnected`. */
export interface Closed {
  readonly _tag: "Closed"
  readonly reason: string
}

/** Whether a link still carries messages. */
export type Status = Open | Closed

/** A transport between this peer and the others. */
export interface NetworkLink {
  /** Hands one message to the transport. Called while the link is open; a message sent after it closed is dropped. */
  readonly send: (message: string) => void
  /** Every message that arrived since the previous call, in arrival order. */
  readonly receive: () => ReadonlyArray<string>
  /** Whether the link is still open. */
  readonly status: () => Status
}

/** The status of a link that is open. */
export const open: Open = { _tag: "Open" }

/** The status of a link that closed, and why. */
export const closed = (reason: string): Closed => ({ _tag: "Closed", reason })
