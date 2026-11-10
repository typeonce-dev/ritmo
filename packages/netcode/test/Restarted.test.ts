import { describe, expect, it } from "vitest"
import { HostClock } from "@typeonce/ritmo"
import { Netcode, NetworkLink } from "@typeonce/ritmo-netcode"

import { idle, makePeer, simulate, step } from "./game.ts"
import { frame, setUpMatch, stepMS } from "./match.ts"

const held = { dx: 1, fire: false }

/** A new session for `seat`, as after its page reloaded, over the link its earlier session used. */
const restart = (match: ReturnType<typeof setUpMatch>, mode: "rollback" | "lockstep", seat: number) => {
  const fresh = makePeer({ count: match.peers.length, setUp: seat === 0 })
  const options = { simulate, seats: fresh.seats, seat, links: [match.links[seat]!], hostClock: match.hostClock, step }
  const made = mode === "rollback" ? Netcode.rollback(fresh.runtime, options) : Netcode.lockstep(fresh.runtime, options)
  if (!made.ok) throw new Error(made.error.reason)
  return made.value
}

/** Advances each session until it ends, for up to `frames` frames, and returns how each ended. */
const untilEnded = (match: ReturnType<typeof setUpMatch>, sessions: ReadonlyArray<Netcode.Session<typeof held, unknown>>, frames: number) => {
  const ended: Array<Netcode.SessionError<unknown> | undefined> = sessions.map(() => undefined)
  for (let at = 0; at < frames && ended.some((error) => error === undefined); at++) {
    for (const [index, session] of sessions.entries()) {
      if (ended[index] !== undefined) continue
      const advanced = session.advance(held)
      if (!advanced.ok) ended[index] = advanced.error
    }
    match.hostClock.adjust(stepMS)
  }
  return ended
}

describe("a seat that starts a new session mid-match", () => {
  for (const mode of ["rollback", "lockstep"] as const) {
    it(`ends the match with Disconnected "restarted" on both sides, instead of stalling it (${mode})`, () => {
      const match = setUpMatch({ mode, latencyMS: 20, jitterMS: 0 })
      for (let at = 0; at < 120; at++) frame(match, at, () => held)
      // Seat 1's page reloads: its earlier session stops, and a new one takes its link.
      const fresh = restart(match, mode, 1)
      const [host, again] = untilEnded(match, [match.peers[0]!.session, fresh], 900)
      // On main, both stayed Stalled: the new session restored seat 0's stored save and waited for inputs seat 0 had pruned.
      expect(host).toMatchObject({ _tag: "Disconnected", seat: 1, reason: "restarted" })
      expect(again).toMatchObject({ _tag: "Disconnected", seat: 1, reason: "restarted" })
    })
  }

  it("ends every peer, a third seat too, when seat 0 restarts", () => {
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 20, jitterMS: 10 })
    for (let at = 0; at < 120; at++) frame(match, at, () => held)
    const fresh = restart(match, "rollback", 0)
    const ended = untilEnded(match, [fresh, match.peers[1]!.session, match.peers[2]!.session], 120)
    for (const error of ended) expect(error).toMatchObject({ _tag: "Disconnected", seat: 0, reason: "restarted" })
  })

  it("ends a new session that hears a match running without it, even when no save reaches it", () => {
    const hostClock = HostClock.test()
    const inbox: Array<string> = []
    const link: NetworkLink.NetworkLink = { send: () => {}, receive: () => inbox.splice(0), status: () => NetworkLink.open }
    const peer = makePeer({ setUp: false })
    const made = Netcode.rollback(peer.runtime, { simulate, seats: peer.seats, seat: 1, links: [link], hostClock, step, timeoutMS: 1000 })
    if (!made.ok) throw new Error(made.error.reason)
    const session = made.value
    let ended: Netcode.SessionError<unknown> | undefined
    let frames = 0
    for (; frames < 200 && ended === undefined; frames++) {
      // Seat 0 is in epoch 3 and never answers this session.
      inbox.push(JSON.stringify({ v: 3, k: "inputs", from: 0, epoch: 3, next: 500, acks: [499, 480], start: 500, inputs: [idle] }))
      const advanced = session.advance(idle)
      if (!advanced.ok) ended = advanced.error
      hostClock.adjust(stepMS)
    }
    expect(ended).toMatchObject({ _tag: "Disconnected", seat: 1, reason: "restarted" })
    expect(frames * stepMS).toBeGreaterThan(1000)
    expect(frames * stepMS).toBeLessThan(1100)
  })
})

describe("status().waiting", () => {
  for (const mode of ["rollback", "lockstep"] as const) {
    it(`names the seat and tick a stalled peer waits for, and for how long (${mode})`, () => {
      const match = setUpMatch({ mode, latencyMS: 20, jitterMS: 0, maxRollback: 8 })
      const [host] = match.peers
      let at = 0
      for (; at < 60; at++) frame(match, at, () => held)
      expect(host!.session.status().waiting).toBeUndefined()
      // Seat 1 stops sending: seat 0 runs what it may, then stalls.
      let stalls = 0
      for (let n = 0; n < 60; n++, at++) {
        frame(match, at, () => held, (seat) => seat === 1)
        if (host!.results.at(-1)?._tag === "Stalled") stalls += 1
      }
      expect(stalls).toBeGreaterThan(30)
      const waiting = host!.session.status().waiting
      const last = host!.session.status().confirmed
      expect(waiting).toEqual({ seat: 1, tick: mode === "rollback" ? last : host!.session.status().tick, forMS: expect.closeTo(stalls * stepMS, 6) })
      // Running again: nothing to wait for.
      for (let n = 0; n < 30; n++, at++) frame(match, at, () => held)
      expect(host!.session.status().waiting).toBeUndefined()
    })
  }
})
