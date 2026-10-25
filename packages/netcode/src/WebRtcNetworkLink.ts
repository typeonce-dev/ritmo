/**
 * A `NetworkLink` over a WebRTC data channel the game already opened: one
 * per other peer, straight between players.
 *
 * Open the channel unordered and without retransmits
 * (`createDataChannel("ritmo", { ordered: false, maxRetransmits: 0 })`): a
 * session sends again what was not acknowledged, so a lost message only
 * costs a frame, where an ordered, reliable channel would hold up every
 * message behind it. Signaling (exchanging offers and candidates) stays with
 * the game. The channel is passed in, so nothing reads a global.
 *
 * @module WebRtcNetworkLink
 * @docGroup netcode
 *
 * @example
 * ```ts
 * declare const connection: RTCPeerConnection
 * // The game's own start: `Netcode.rollback(runtime, { ...options, links })` (see `Netcode`).
 * declare const startMatch: (links: ReadonlyArray<NetworkLink.NetworkLink>) => void
 * // ---cut---
 * const channel = connection.createDataChannel("ritmo", { ordered: false, maxRetransmits: 0 })
 * channel.addEventListener("open", () => startMatch([WebRtcNetworkLink.make(channel)]))
 * ```
 */
import * as NetworkLink from "./NetworkLink.ts"

/** What the link needs from an `RTCDataChannel`. */
export interface Channel {
  readonly readyState: "connecting" | "open" | "closing" | "closed"
  send(data: string): void
  addEventListener(type: "message" | "close", listener: (event: { readonly data?: unknown }) => void): void
}

/** A link that sends and receives over `channel`. Messages that are not text are ignored. */
export const make = (channel: Channel): NetworkLink.NetworkLink => {
  let inbox: Array<string> = []
  let closed = false
  channel.addEventListener("message", (event) => {
    if (typeof event.data === "string") inbox.push(event.data)
  })
  channel.addEventListener("close", () => {
    closed = true
  })
  return {
    send: (message) => {
      if (channel.readyState === "open") channel.send(message)
    },
    receive: () => {
      const arrived = inbox
      inbox = []
      return arrived
    },
    status: () =>
      closed || channel.readyState === "closing" || channel.readyState === "closed"
        ? NetworkLink.closed("the data channel closed")
        : NetworkLink.open
  }
}
