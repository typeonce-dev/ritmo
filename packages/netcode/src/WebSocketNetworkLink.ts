/**
 * A `NetworkLink` over a WebSocket the game already opened: to a relay
 * server that forwards every message to the other peers of the match.
 *
 * The socket is passed in, so nothing reads a global: the browser's
 * `WebSocket`, Node's (22 and later), Deno's, and Bun's all fit. Where to
 * connect, when to retry, and how the server groups peers into a match stay
 * with the game. A WebSocket delivers in order and loses nothing while it
 * is open, so it is the simplest transport; under packet loss its in-order
 * delivery holds up later messages, where `WebRtcNetworkLink` does not.
 *
 * @module WebSocketNetworkLink
 * @docGroup netcode
 *
 * @example
 * ```ts
 * // The game's own start: `Netcode.rollback(runtime, { ...options, links })` (see `Netcode`).
 * declare const startMatch: (links: ReadonlyArray<NetworkLink.NetworkLink>) => void
 * // ---cut---
 * const socket = new WebSocket("wss://relay.example.com/match/42")
 * socket.addEventListener("open", () => startMatch([WebSocketNetworkLink.make(socket)]))
 * ```
 */
import * as NetworkLink from "./NetworkLink.ts"

/** What the link needs from a WebSocket. */
export interface Socket {
  /** 0 connecting, 1 open, 2 closing, 3 closed. */
  readonly readyState: number
  send(data: string): void
  addEventListener(type: "message" | "close", listener: (event: { readonly data?: unknown; readonly reason?: string }) => void): void
}

const OPEN = 1

/** A link that sends and receives over `socket`. Messages that are not text are ignored. */
export const make = (socket: Socket): NetworkLink.NetworkLink => {
  let inbox: Array<string> = []
  let closedReason: string | undefined
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") inbox.push(event.data)
  })
  socket.addEventListener("close", (event) => {
    closedReason ??= event.reason === undefined || event.reason === "" ? "the WebSocket closed" : event.reason
  })
  return {
    send: (message) => {
      if (socket.readyState === OPEN) socket.send(message)
    },
    receive: () => {
      const arrived = inbox
      inbox = []
      return arrived
    },
    status: () => {
      if (closedReason !== undefined) return NetworkLink.closed(closedReason)
      return socket.readyState > OPEN ? NetworkLink.closed("the WebSocket closed") : NetworkLink.open
    }
  }
}
