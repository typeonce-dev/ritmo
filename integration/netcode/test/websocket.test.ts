import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { WebSocketServer, type WebSocket as ServerSocket } from "ws"

import { HostClock } from "@typeonce/ritmo"
import { Netcode, WebSocketNetworkLink } from "@typeonce/ritmo-netcode"

import { draw, idle, makeRuntime, playerInput, setup, simulate, step } from "../game.ts"

/** A relay: every message from one client goes to every other one. */
let server: WebSocketServer
let url: string
beforeAll(async () => {
  server = new WebSocketServer({ port: 0 })
  server.on("connection", (client: ServerSocket) => {
    client.on("message", (data, binary) => {
      for (const other of server.clients) if (other !== client && other.readyState === 1) other.send(data, { binary })
    })
  })
  await new Promise<void>((resolve) => server.on("listening", () => resolve()))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("expected a port")
  url = `ws://127.0.0.1:${address.port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

// oxlint-disable-next-line ritmo/keep-simulation-headless -- this test is the host: it opens the connections the sessions run over.
const connect = (): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    // oxlint-disable-next-line ritmo/keep-simulation-headless -- the host opens the connection, as a game does.
    const socket = new WebSocket(url)
    socket.addEventListener("open", () => resolve(socket))
    socket.addEventListener("error", () => reject(new Error("could not connect")))
  })

// oxlint-disable-next-line ritmo/use-clock-for-time -- this test is the host: it yields to the relay between ticks, as a game's loop does.
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("two peers over a real WebSocket relay", () => {
  it("play the shooter in rollback and agree on every compared tick", async () => {
    const sockets = await Promise.all([connect(), connect()])
    const hostClock = HostClock.standard
    const peers = sockets.map((socket, seat) => {
      const seats = Netcode.seats(playerInput, { count: 2, idle })
      if (!seats.ok) throw new Error(seats.error.reason)
      const { runtime } = makeRuntime(seats.value.source)
      if (seat === 0 && !runtime.tick(setup).ok) throw new Error("setup failed")
      const session = Netcode.rollback(runtime, {
        simulate, seats: seats.value, seat, links: [WebSocketNetworkLink.make(socket)], hostClock, step, checksumEvery: 10
      })
      if (!session.ok) throw new Error(session.error.reason)
      return { runtime, session: session.value }
    })
    for (let frame = 0; frame < 400; frame++) {
      for (const [seat, { runtime, session }] of peers.entries()) {
        const advanced = session.advance({ dx: frame % 50 < 25 ? 1 : -1, dy: seat === 0 ? 1 : -1, fire: (frame + seat) % 9 === 0 })
        if (!advanced.ok) throw new Error(`seat ${seat}, frame ${frame}: ${JSON.stringify(advanced.error)}`)
        expect(runtime.tick(draw).ok).toBe(true)
      }
      // Let the sockets deliver.
      await nextTurn()
    }
    for (const { session } of peers) {
      expect(session.status().epoch).toBe(1)
      expect(session.status().verified).toBeGreaterThan(200)
    }
    for (const socket of sockets) socket.close()
  })
})
