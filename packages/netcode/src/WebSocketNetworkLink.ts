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
 * One socket often carries a lobby and its match: give `make` a `prefix`
 * and the link writes it before each message it sends, reads only the
 * messages that start with it (without it), and leaves the rest to the
 * game. The relay forwards the session's messages as they are.
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
 *
 * @example
 * ```ts
 * declare const startMatch: (links: ReadonlyArray<NetworkLink.NetworkLink>) => void
 * declare const lobby: { receive(message: unknown): void }
 * // ---cut---
 * // One socket to the room: the lobby's messages are JSON, the match's start with "n".
 * const socket = new WebSocket("wss://relay.example.com/room/42")
 * startMatch([WebSocketNetworkLink.make(socket, { prefix: "n" })])
 * socket.addEventListener("message", (event) => {
 *   // The link reads the messages that start with its prefix: the game reads the rest.
 *   if (typeof event.data !== "string" || event.data.startsWith("n")) return
 *   lobby.receive(JSON.parse(event.data))
 * })
 * const sendToLobby = (message: object) => socket.send(JSON.stringify(message)) // never starts with "n"
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

/** Resolves to the prefix when it is one, otherwise to the fix. */
export type ValidPrefix<Prefix extends string> = Prefix extends "" ? "prefix is a non-empty string that the game's own messages never start with" : Prefix

/** Options of {@link make}. */
export interface Options<Prefix extends string> {
  /**
   * For a socket that also carries the game's own messages (a lobby): the
   * link writes `prefix` before each message it sends and reads only the
   * text messages that start with it, which it hands on without it. The
   * game's own messages must never start with it: a lobby that sends JSON
   * never starts with `"n"`, for example. Without it, the link reads every
   * text message on the socket.
   */
  readonly prefix: ValidPrefix<Prefix>
}

const OPEN = 1

/**
 * A link that sends and receives over `socket`. Messages that are not text
 * are ignored, and with `prefix`, every message that does not start with it.
 * Throws for an empty `prefix`: a defect, which the types reject too.
 */
export const make = <const Prefix extends string>(socket: Socket, options?: Options<Prefix>): NetworkLink.NetworkLink => {
  const prefix: string = options?.prefix ?? ""
  if (options !== undefined && prefix === "") throw new Error(`WebSocketNetworkLink: prefix is a non-empty string that the game's own messages never start with`)
  let inbox: Array<string> = []
  let closedReason: string | undefined
  socket.addEventListener("message", prefix === ""
    ? (event) => {
      if (typeof event.data === "string") inbox.push(event.data)
    }
    : (event) => {
      if (typeof event.data === "string" && event.data.startsWith(prefix)) inbox.push(event.data.slice(prefix.length))
    })
  socket.addEventListener("close", (event) => {
    closedReason ??= event.reason === undefined || event.reason === "" ? "the WebSocket closed" : event.reason
  })
  return {
    send: prefix === ""
      ? (message) => {
        if (socket.readyState === OPEN) socket.send(message)
      }
      : (message) => {
        if (socket.readyState === OPEN) socket.send(prefix + message)
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
