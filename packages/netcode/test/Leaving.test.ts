import { describe, expect, it } from "vitest"
import { HostClock } from "@typeonce/ritmo"
import { MemoryNetworkLink, MemoryVisibility, Netcode } from "@typeonce/ritmo-netcode"

import { Fired, idle, makePeer, pressed, simulate, step, type PlayerInput } from "./game.ts"
import { checksumOf, leave, playOn, reference, setUpMatch, settleOn, staying, stepMS, wire, type MatchPeer } from "./match.ts"

type Match = ReturnType<typeof setUpMatch>

/** A seat without a driver fires on every tick: the simulation, and every event reader, shows the tick it left on. */
const left: PlayerInput = { dx: 2, fire: true }

/**
 * Every peer still there names the same seats as left, on the same ticks,
 * and holds the world of one runtime that knew every input: each seat's own
 * up to its last one, idle after it, and `left` from the tick it left on.
 */
const expectAgreement = (match: Match) => {
  const peers = staying(match)
  const out = peers[0]!.session.status().left
  for (const peer of peers) expect(peer.session.status().left).toEqual(out)
  const sums = reference(match.peers, Math.max(...peers.map((peer) => peer.session.status().tick)), out, match.options.left).sums
  for (const peer of peers) expect(checksumOf(peer)).toBe(sums[peer.session.status().tick])
  return out
}

/** Host readers of `Fired`, one per peer, read after every frame as a game's `render` does. */
const readers = (match: Match) => {
  const seen = match.peers.map((peer) => ({
    reader: peer.session.events(Fired),
    confirmed: [] as Array<Netcode.EventRecord<{ readonly seat: number; readonly x: number }>>,
    lost: [] as Array<Netcode.EventsLost>
  }))
  const read = () => {
    for (const [seat, one] of seen.entries()) {
      if (match.departed.has(seat)) continue
      one.confirmed.push(...one.reader.confirmed())
      one.reader.predicted()
      one.reader.withdrawn()
      const lost = one.reader.lost()
      if (lost !== undefined) one.lost.push(lost)
    }
  }
  /** Plays `frames` frames from frame `from`, reading every reader after each. */
  const play = (from: number, frames: number, options: { readonly idle?: boolean } = {}) => {
    for (let at = from; at < from + frames; at++) {
      playOn(match, 1, { input: (seat) => options.idle === true ? idle : pressed(seat, at) })
      read()
    }
    return from + frames
  }
  /** Each staying peer was handed exactly the events of the reference, each once, and lost none. */
  const expectExact = () => {
    read()
    const peers = staying(match)
    const out = peers[0]!.session.status().left
    const settledOf = (peer: MatchPeer) => Math.min(peer.session.status().confirmed, peer.session.status().tick)
    const { fired } = reference(match.peers, Math.max(...peers.map(settledOf)), out, match.options.left)
    for (const [seat, peer] of match.peers.entries()) {
      if (match.departed.has(seat)) continue
      const settled = settledOf(peer)
      expect(seen[seat]!.lost).toEqual([])
      expect(seen[seat]!.confirmed).toEqual(fired.filter(({ tick }) => tick < settled))
    }
  }
  return { seen, play, expectExact }
}

describe("a seat that leaves for good", () => {
  for (const mode of ["rollback", "lockstep"] as const) {
    it(`is played around once it was silent for timeoutMS, and the others agree on its last input (${mode})`, () => {
      const match = setUpMatch({ mode, count: 3, latencyMS: 40, jitterMS: 30, timeoutMS: 500, checksumEvery: 10, left })
      playOn(match, 120)
      leave(match, 2)
      const leftAt = match.peers[0]!.session.status().tick
      playOn(match, 240)
      settleOn(match)
      expect(match.halts).toEqual([])
      const out = expectAgreement(match)
      expect(out[0]).toBeUndefined()
      expect(out[1]).toBeUndefined()
      // Its own inputs end where the furthest peer had them; from the next tick, every peer reads `left` for it.
      expect(out[2]).toEqual({ reason: "timeout", lastInput: expect.any(Number), tick: out[2]!.lastInput + 1 })
      expect(Math.abs(out[2]!.lastInput - leftAt)).toBeLessThan(20)
      for (const peer of staying(match)) {
        const status = peer.session.status()
        // On main, both ended with Disconnected half a second after seat 2 left. (Lockstep waited that long for it; rollback ran on.)
        expect(status.tick).toBeGreaterThan(leftAt + 120)
        expect(status.verified).toBeGreaterThan(leftAt + 100)
        expect(status.epoch).toBe(1)
        expect(status.waiting).toBeUndefined()
      }
    })
  }

  it("is named in status().waiting while the others wait for it, then in status().left", () => {
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 20, jitterMS: 0, timeoutMS: 500, maxRollback: 8 })
    const [host] = match.peers
    playOn(match, 60)
    leave(match, 1)
    playOn(match, 20, { input: () => idle })
    expect(host!.session.status().waiting?.seat).toBe(1)
    expect(host!.session.status().left).toEqual([undefined, undefined, undefined])
    expect(host!.results).toEqual([])
    playOn(match, 30, { input: () => idle })
    expect(host!.session.status().waiting).toBeUndefined()
    expect(host!.session.status().left[1]?.reason).toBe("timeout")
  })

  it("hands every reader the same events, each once, through the ticks run again without it (8 seats, a lossy link)", { timeout: 30_000 }, () => {
    const match = setUpMatch({ mode: "rollback", count: 8, seed: 3, latencyMS: 60, jitterMS: 50, loss: 0.08, maxRollback: 24, checkpoints: 24, timeoutMS: 800, checksumEvery: 10, left })
    const events = readers(match)
    let at = events.play(0, 150)
    leave(match, 5)
    at = events.play(at, 200)
    // The transport tells some peers at once that seat 2 is gone, as a relay that saw its socket close does; the others hear it from them.
    leave(match, 2)
    match.peers[6]!.session.drop(2)
    at = events.play(at, 3)
    match.peers[0]!.session.drop(2)
    at = events.play(at, 200)
    events.play(at, 90, { idle: true })
    settleOn(match)
    expect(match.halts).toEqual([])
    const out = expectAgreement(match)
    expect(out.map((one) => one?.reason)).toEqual([undefined, undefined, "dropped", undefined, undefined, "timeout", undefined, undefined])
    events.expectExact()
    // The seats without a driver fired on every tick from the one they left on: the readers heard each of those once.
    const heard = events.seen[7]!.confirmed
    for (const seat of [2, 5]) {
      const ticks = heard.filter((record) => record.value.seat === seat && record.tick >= out[seat]!.tick).map((record) => record.tick)
      expect(ticks.slice(0, 50)).toEqual(Array.from({ length: 50 }, (_, index) => out[seat]!.tick + index))
    }
    for (const peer of staying(match)) expect(peer.session.status().rollbacks).toBeGreaterThan(0)
  })

  it("plays six seats on in lockstep, with nothing run again", () => {
    const match = setUpMatch({ mode: "lockstep", count: 6, seed: 9, latencyMS: 40, jitterMS: 30, loss: 0.05, timeoutMS: 600, checksumEvery: 10, left })
    const events = readers(match)
    let at = events.play(0, 120)
    leave(match, 4)
    leave(match, 1)
    at = events.play(at, 300)
    events.play(at, 60, { idle: true })
    settleOn(match)
    expect(match.halts).toEqual([])
    const out = expectAgreement(match)
    expect(out.map((one) => one?.reason)).toEqual([undefined, "timeout", undefined, undefined, "timeout", undefined])
    events.expectExact()
    for (const peer of staying(match)) expect(peer.session.status().rollbacks).toBe(0)
  })

  it("is out at once when a session is told the transport saw it go: session.drop", () => {
    const match = setUpMatch({ mode: "rollback", count: 4, latencyMS: 40, jitterMS: 20, checksumEvery: 10, left })
    playOn(match, 90)
    leave(match, 3)
    // One peer is told: it tells the others.
    match.peers[1]!.session.drop(3)
    // Well inside the five seconds a silent seat would take.
    playOn(match, 30)
    for (const peer of staying(match)) expect(peer.session.status().left[3]?.reason).toBe("dropped")
    playOn(match, 120)
    settleOn(match)
    expect(match.halts).toEqual([])
    expectAgreement(match)
  })

  it("drops only another seat of the match, and nothing before the match started", () => {
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 20, jitterMS: 0 })
    const [host] = match.peers
    expect(() => host!.session.drop(0)).toThrow("not this session's own (0)")
    expect(() => host!.session.drop(3)).toThrow("names no other seat")
    expect(() => host!.session.drop(0.5)).toThrow("names no other seat")
    // No match yet: there is nobody to play on with.
    host!.session.drop(2)
    playOn(match, 60)
    expect(match.halts).toEqual([])
    for (const peer of match.peers) expect(peer.session.status().left).toEqual([undefined, undefined, undefined])
  })
})

describe("messages about the roster", () => {
  it("are dropped when malformed, and change nothing when a seat that does not decide sends them", () => {
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 0, jitterMS: 0 })
    const [host] = match.peers
    playOn(match, 30)
    const send = (from: number, message: object) => match.links[from]!.send(wire({ from, epoch: 1, ...message }))
    const change = { k: "left", roster: 1, by: 0, seats: [2], why: ["timeout"], last: [5], tick: [6], seat: 2, start: 6, inputs: [] }
    // The seat that decides is one of those it puts out; a seat whose `left` input starts on its last own tick; a seat twice; inputs past the last one.
    send(1, { ...change, by: 2 })
    send(1, { ...change, tick: [5] })
    send(1, { ...change, seats: [2, 2], why: ["timeout", "timeout"], last: [5, 5], tick: [6, 6] })
    send(1, { ...change, start: 5, inputs: [idle, idle] })
    // A report of itself, and one with a reason that is none; a notice without its tick.
    send(1, { k: "gone", seat: 1, why: "timeout", have: 5, start: 6, inputs: [] })
    send(1, { k: "gone", seat: 2, why: "bored", have: 5, start: 6, inputs: [] })
    send(1, { k: "out", seat: 0, why: "timeout", last: 5 })
    playOn(match, 5)
    expect(host!.session.status().dropped).toBe(7)
    // Well formed, from seat 2, which does not decide while seat 0 plays: seat 1 stays.
    send(2, { ...change, by: 2, seats: [1], seat: 1 })
    playOn(match, 60)
    expect(match.halts).toEqual([])
    for (const peer of match.peers) {
      expect(peer.session.status().left).toEqual([undefined, undefined, undefined])
      expect(peer.session.status().tick).toBeGreaterThan(80)
    }
    expect(host!.session.status().dropped).toBe(7)
  })
})

describe("the host leaving", () => {
  it("hands the match to the next seat: the others play on, and it makes the saves", () => {
    const match = setUpMatch({ mode: "rollback", count: 4, latencyMS: 40, jitterMS: 30, timeoutMS: 500, checksumEvery: 10, left })
    const events = readers(match)
    let at = events.play(0, 120)
    leave(match, 0)
    at = events.play(at, 240)
    events.play(at, 60, { idle: true })
    settleOn(match)
    expect(match.halts).toEqual([])
    const out = expectAgreement(match)
    // On main, every peer ended with Disconnected.
    expect(out[0]?.reason).toBe("timeout")
    events.expectExact()
    for (const peer of staying(match)) expect(peer.session.status().epoch).toBe(1)
    // A resync a peer asks for is now seat 1's to answer.
    match.peers[3]!.session.resync()
    playOn(match, 120)
    settleOn(match)
    expect(match.halts).toEqual([])
    for (const peer of staying(match)) {
      const status = peer.session.status()
      expect(status.epoch).toBe(2)
      expect(status.left.map((one) => one?.reason)).toEqual(["timeout", undefined, undefined, undefined])
      expect(status.verified).toBeGreaterThan(status.tick - 40)
    }
    expect(new Set(staying(match).map(checksumOf)).size).toBe(1)
  })

  it("with the seat after it, in one change, when both go at once (8 seats)", { timeout: 30_000 }, () => {
    const match = setUpMatch({ mode: "rollback", count: 8, seed: 21, latencyMS: 50, jitterMS: 40, loss: 0.05, maxRollback: 24, checkpoints: 24, timeoutMS: 600, checksumEvery: 10, left })
    const events = readers(match)
    let at = events.play(0, 150)
    leave(match, 0)
    leave(match, 1)
    at = events.play(at, 300)
    events.play(at, 90, { idle: true })
    settleOn(match)
    expect(match.halts).toEqual([])
    const out = expectAgreement(match)
    expect(out.map((one) => one?.reason)).toEqual(["timeout", "timeout", undefined, undefined, undefined, undefined, undefined, undefined])
    events.expectExact()
  })

  it("when the transport says so, only once every other peer was told", () => {
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 30, jitterMS: 10, checksumEvery: 10 })
    playOn(match, 90)
    // Seat 2 alone is told that seat 0 is gone, while seat 0 still plays: seat 0 stays, and the seat that cannot hear it is the one out. A save seats it again.
    match.peers[2]!.session.drop(0)
    playOn(match, 180)
    settleOn(match)
    expect(match.halts).toEqual([])
    for (const peer of match.peers) {
      expect(peer.session.status().left).toEqual([undefined, undefined, undefined])
      expect(peer.session.status().epoch).toBe(2)
    }
    expect(new Set(match.peers.map(checksumOf)).size).toBe(1)
    // Seat 0's page is gone, and both others are told: now it is out.
    leave(match, 0)
    match.peers[1]!.session.drop(0)
    match.peers[2]!.session.drop(0)
    playOn(match, 120)
    settleOn(match)
    expect(match.halts).toEqual([])
    for (const peer of staying(match)) expect(peer.session.status().left[0]?.reason).toBe("dropped")
    expect(new Set(staying(match).map(checksumOf)).size).toBe(1)
  })
})

describe("the last seat in a match", () => {
  const untilEnded = (match: Match, peer: MatchPeer, frames: number) => {
    for (let at = 0; at < frames; at++) {
      const advanced = peer.session.advance(idle)
      match.hostClock.adjust(stepMS)
      if (!advanced.ok) return { error: advanced.error, frames: at }
    }
    return undefined
  }

  it("ends with Disconnected, naming the last seat that left and why", () => {
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 20, jitterMS: 0, timeoutMS: 500 })
    playOn(match, 60)
    leave(match, 1)
    playOn(match, 120)
    expect(match.halts).toEqual([])
    expect(match.peers[0]!.session.status().left[1]?.reason).toBe("timeout")
    leave(match, 2)
    const ended = untilEnded(match, match.peers[0]!, 200)
    expect(ended?.error).toMatchObject({ _tag: "Disconnected", who: "others", seat: 2, reason: "timeout" })
    // The session stays ended.
    expect(match.peers[0]!.session.advance(idle).ok).toBe(false)
  })

  it("of two ends as before: after timeoutMS, or at once when told", () => {
    const silent = setUpMatch({ mode: "rollback", latencyMS: 20, jitterMS: 0, timeoutMS: 1000 })
    playOn(silent, 30)
    leave(silent, 1)
    const ended = untilEnded(silent, silent.peers[0]!, 200)
    expect(ended?.error).toMatchObject({ _tag: "Disconnected", who: "others", seat: 1, reason: "timeout" })
    expect(ended!.frames * stepMS).toBeGreaterThan(900)
    expect(ended!.frames * stepMS).toBeLessThan(1100)

    const told = setUpMatch({ mode: "lockstep", latencyMS: 20, jitterMS: 0 })
    playOn(told, 30)
    leave(told, 0)
    told.peers[1]!.session.drop(0)
    expect(untilEnded(told, told.peers[1]!, 5)).toMatchObject({ frames: 0, error: { _tag: "Disconnected", who: "others", seat: 0, reason: "dropped" } })
  })
})

describe("a hidden seat that never returns", () => {
  it("is out of the match after afterMS + timeoutMS, from a tick every peer agrees on", () => {
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 30, jitterMS: 20, timeoutMS: 500, checksumEvery: 10, left, hidden: { afterMS: 500, then: "resync-on-return" } })
    const events = readers(match)
    let at = events.play(0, 90)
    match.peers[2]!.visibility.hide()
    const hiddenAt = match.peers[0]!.session.status().tick
    // Played around with idle input for a second, then out: the tab was closed.
    at = events.play(at, 30)
    expect(match.peers[0]!.session.status().left[2]).toBeUndefined()
    expect(match.peers[0]!.session.status().hidden[2]).toBe(true)
    at = events.play(at, 120)
    match.departed.add(2)
    events.play(at, 60, { idle: true })
    settleOn(match)
    expect(match.halts).toEqual([])
    const out = expectAgreement(match)
    expect(out[2]?.reason).toBe("timeout")
    // Idle from its last input, which the peers confirmed ticks with: `left` only from a later tick.
    expect(out[2]!.tick).toBeGreaterThan(out[2]!.lastInput + 50)
    expect(out[2]!.tick).toBeGreaterThan(hiddenAt + 55)
    expect(match.peers[0]!.session.status().hidden[2]).toBe(false)
    events.expectExact()
  })
})

describe("a mesh: one link per peer", () => {
  /** Every pair of peers joined by its own two-ended link, as WebRTC channels are. */
  const mesh = (count: number) => {
    const hostClock = HostClock.test()
    const ends: Array<Array<MemoryNetworkLink.MemoryNetworkLink>> = Array.from({ length: count }, () => [])
    const pairs: Array<{ readonly seats: readonly [number, number]; readonly links: ReadonlyArray<MemoryNetworkLink.MemoryNetworkLink> }> = []
    for (let low = 0; low < count; low++) {
      for (let high = low + 1; high < count; high++) {
        const pair = MemoryNetworkLink.make({ peers: 2, hostClock, seed: low * 8 + high, latencyMS: 30, jitterMS: 20 })
        if (!pair.ok) throw new Error(pair.error.field)
        ends[low]!.push(pair.value[0]!)
        ends[high]!.push(pair.value[1]!)
        pairs.push({ seats: [low, high], links: pair.value })
      }
    }
    const peers = Array.from({ length: count }, (_, seat) => {
      const peer = makePeer({ count, setUp: seat === 0 })
      const made = Netcode.rollback(peer.runtime, { simulate, seats: peer.seats, seat, links: ends[seat]!, hostClock, step, checksumEvery: 10, hidden: { visibility: MemoryVisibility.make(), afterMS: 0, then: "stall" } })
      if (!made.ok) throw new Error(made.error.reason)
      return { ...peer, session: made.value }
    })
    const ended = new Map<number, Netcode.SessionError<unknown>>()
    const gone = new Set<number>()
    const play = (frames: number, from: number) => {
      for (let at = from; at < from + frames; at++) {
        for (const [seat, peer] of peers.entries()) {
          if (gone.has(seat) || ended.has(seat)) continue
          const advanced = peer.session.advance(at < 400 ? pressed(seat, at) : idle)
          if (!advanced.ok) ended.set(seat, advanced.error)
        }
        hostClock.adjust(stepMS)
      }
      return from + frames
    }
    /** The channel between two seats closes, at both ends. */
    const cut = (one: number, other: number) => {
      for (const pair of pairs) if (pair.seats.includes(one) && pair.seats.includes(other)) for (const link of pair.links) link.close("the channel closed")
    }
    return { peers, ended, gone, play, cut }
  }

  it("plays on without a peer whose channels closed, each peer learning it from its own link", () => {
    const match = mesh(4)
    let at = match.play(90, 0)
    match.gone.add(2)
    for (const other of [0, 1, 3]) match.cut(2, other)
    at = match.play(200, at)
    match.play(200, 400)
    expect([...match.ended]).toEqual([])
    const staying = match.peers.filter((_, seat) => seat !== 2)
    for (const peer of staying) expect(peer.session.status().left.map((one) => one?.reason)).toEqual([undefined, undefined, "closed", undefined])
    expect(new Set(staying.map((peer) => peer.session.status().left[2]!.tick)).size).toBe(1)
    expect(Math.min(...staying.map((peer) => peer.session.status().verified))).toBeGreaterThan(at - 60)
  })

  it("puts one of two peers out when the channel between them closes, and ends its session: it cannot reach a seat that plays", () => {
    const match = mesh(4)
    match.play(90, 0)
    match.cut(1, 3)
    match.play(200, 90)
    match.play(200, 400)
    // Each reported the other: the seat that decides took the first report it heard.
    expect(match.ended.size).toBe(1)
    const [[out, error]] = [...match.ended] as [[number, Netcode.SessionError<unknown>]]
    expect([1, 3]).toContain(out)
    expect(error).toMatchObject({ _tag: "Disconnected", who: "self", seat: out, reason: "closed" })
    const staying = match.peers.filter((_, seat) => seat !== out)
    for (const peer of staying) expect(peer.session.status().left.map((one, seat) => seat === out ? one?.reason : one)).toEqual([0, 1, 2, 3].map((seat) => seat === out ? "closed" : undefined))
    expect(Math.min(...staying.map((peer) => peer.session.status().verified))).toBeGreaterThan(300)
  })

  it("ends a session once every one of its links closed", () => {
    const match = mesh(3)
    match.play(60, 0)
    match.cut(0, 1)
    match.cut(0, 2)
    match.play(5, 60)
    expect(match.ended.get(0)).toEqual({ _tag: "Disconnected", who: "self", seat: 0, reason: "closed", detail: "the channel closed" })
  })
})
