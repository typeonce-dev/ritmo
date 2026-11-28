import { describe, expect, it } from "vitest"
import { HostClock } from "@typeonce/ritmo"
import { Netcode, NetworkLink, WebRtcNetworkLink, WebSocketNetworkLink } from "@typeonce/ritmo-netcode"

import { makePeer, pressed, simulate, step } from "./game.ts"

/** A stand-in for a WebSocket or a data channel: the test opens, delivers, and closes it. */
const fake = <State>(initial: State) => {
  const listeners = new Map<string, Array<(event: { readonly data?: unknown; readonly reason?: string }) => void>>()
  const sent: Array<string> = []
  const socket = {
    readyState: initial,
    send: (data: string) => {
      sent.push(data)
    },
    addEventListener: (type: string, listener: (event: { readonly data?: unknown; readonly reason?: string }) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    }
  }
  const emit = (type: string, event: { readonly data?: unknown; readonly reason?: string }) => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  return { socket, sent, emit }
}

describe("WebSocketNetworkLink.make", () => {
  it("sends while open, receives text, and reports the close reason", () => {
    const { socket, sent, emit } = fake(0)
    const link = WebSocketNetworkLink.make(socket)
    link.send("too early")
    socket.readyState = 1
    link.send("hello")
    emit("message", { data: "one" })
    emit("message", { data: new Uint8Array([1]) })
    emit("message", { data: "two" })
    expect(sent).toEqual(["hello"])
    expect(link.receive()).toEqual(["one", "two"])
    expect(link.receive()).toEqual([])
    expect(link.status()).toEqual(NetworkLink.open)
    socket.readyState = 3
    emit("close", { reason: "server restarted" })
    expect(link.status()).toEqual(NetworkLink.closed("server restarted"))
  })

  it("shares a socket with the game's own messages under a prefix", () => {
    const { socket, sent, emit } = fake(1)
    const link = WebSocketNetworkLink.make(socket, { prefix: "n" })
    // The game's own message on the same socket, as its lobby sends it.
    socket.send(JSON.stringify({ lobby: "ready" }))
    link.send("{\"v\":7}")
    expect(sent).toEqual(["{\"lobby\":\"ready\"}", "n{\"v\":7}"])
    // Lobby messages, a binary one, and the session's, mixed in one stream: the link reads only its own, without the prefix.
    emit("message", { data: "{\"lobby\":\"start\"}" })
    emit("message", { data: "n{\"from\":1}" })
    emit("message", { data: new Uint8Array([110]) })
    emit("message", { data: "{\"chat\":\"n\"}" })
    emit("message", { data: "n" })
    emit("message", { data: "n{\"from\":2}" })
    expect(link.receive()).toEqual(["{\"from\":1}", "", "{\"from\":2}"])
    expect(link.receive()).toEqual([])
  })

  it("rejects an empty prefix", () => {
    const { socket } = fake(1)
    // @ts-expect-error the game's own messages never start with
    expect(() => WebSocketNetworkLink.make(socket, { prefix: "" })).toThrow("non-empty string")
  })

  it("plays a match of two over sockets that also carry a lobby, through a relay that forwards both", () => {
    const hostClock = HostClock.test()
    const sockets = [fake(1), fake(1)]
    // A room: every text message from one socket goes to the other, the lobby's and the match's alike.
    const relay = () => {
      for (const [from, one] of sockets.entries()) for (const data of one.sent.splice(0)) sockets[1 - from]!.emit("message", { data })
    }
    const lobby: Array<Array<unknown>> = [[], []]
    const peers = sockets.map((one, seat) => {
      one.socket.addEventListener("message", (event) => {
        if (typeof event.data === "string" && !event.data.startsWith("n")) lobby[seat]!.push(JSON.parse(event.data))
      })
      const peer = makePeer({ setUp: seat === 0 })
      const session = Netcode.rollback(peer.runtime, { simulate, seats: peer.seats, seat, links: [WebSocketNetworkLink.make(one.socket, { prefix: "n" })], hostClock, step, checksumEvery: 10 })
      if (!session.ok) throw new Error(session.error.reason)
      return { ...peer, session: session.value }
    })
    for (let at = 0; at < 240; at++) {
      // The lobby keeps talking during the match.
      if (at % 30 === 0) for (const [seat, one] of sockets.entries()) one.socket.send(JSON.stringify({ chat: at, from: seat }))
      for (const [seat, peer] of peers.entries()) expect(peer.session.advance(pressed(seat, at)).ok).toBe(true)
      relay()
      hostClock.adjust(step.dt * 1000)
    }
    for (const peer of peers) {
      const status = peer.session.status()
      expect(status.dropped).toBe(0)
      expect(status.verified).toBeGreaterThan(150)
    }
    expect(lobby[1]).toHaveLength(8)
    expect(lobby[0]).toEqual(Array.from({ length: 8 }, (_, index) => ({ chat: index * 30, from: 1 })))
  })
})

describe("WebRtcNetworkLink.make", () => {
  it("sends while open, receives text, and closes with the channel", () => {
    const { socket, sent, emit } = fake<"connecting" | "open" | "closing" | "closed">("connecting")
    const link = WebRtcNetworkLink.make(socket)
    link.send("too early")
    socket.readyState = "open"
    link.send("hello")
    emit("message", { data: "one" })
    expect(sent).toEqual(["hello"])
    expect(link.receive()).toEqual(["one"])
    socket.readyState = "closing"
    expect(link.status()._tag).toBe("Closed")
  })
})
