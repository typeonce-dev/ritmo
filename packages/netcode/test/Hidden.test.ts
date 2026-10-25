import { describe, expect, it } from "vitest"
import { HostClock } from "@typeonce/ritmo"
import { MemoryNetworkLink, MemoryVisibility, Netcode } from "@typeonce/ritmo-netcode"

import { idle, makePeer, pressed, simulate, step, type PlayerInput } from "./game.ts"
import { checksumOf, stepMS } from "./match.ts"

interface HiddenMatchOptions {
  readonly mode?: "rollback" | "lockstep"
  readonly count?: number
  readonly then: Netcode.HiddenPolicy
  readonly afterMS: number
  readonly timeoutMS?: number
  readonly loss?: number
}

/** Peers over memory links, each with a page a test hides; a hidden page also stops calling `advance`, as a browser stops its frames. */
const setUp = (options: HiddenMatchOptions) => {
  const count = options.count ?? 2
  const hostClock = HostClock.test()
  const links = MemoryNetworkLink.make({ peers: count, hostClock, seed: 5, latencyMS: 30, jitterMS: 20, loss: options.loss ?? 0 })
  if (!links.ok) throw new Error(links.error.field)
  const peers = Array.from({ length: count }, (_, seat) => {
    const peer = makePeer({ count, setUp: seat === 0 })
    const visibility = MemoryVisibility.make()
    const shared = {
      simulate,
      seats: peer.seats,
      seat,
      links: [links.value[seat]!],
      hostClock,
      step,
      checksumEvery: 10,
      timeoutMS: options.timeoutMS ?? 1000,
      hidden: { visibility, afterMS: options.afterMS, then: options.then }
    }
    const session = options.mode === "lockstep" ? Netcode.lockstep(peer.runtime, shared) : Netcode.rollback(peer.runtime, shared)
    if (!session.ok) throw new Error(session.error.reason)
    return { ...peer, visibility, session: session.value, results: [] as Array<Netcode.Advanced>, failure: undefined as Netcode.SessionError<unknown> | undefined }
  })
  /** One frame for every peer whose page is shown; the clock moves one step. */
  const frame = (input: (seat: number) => PlayerInput = () => idle, skip: (seat: number) => boolean = () => false): void => {
    for (const [seat, peer] of peers.entries()) {
      if (peer.visibility.hidden() || peer.failure !== undefined || skip(seat)) continue
      const advanced = peer.session.advance(input(seat))
      if (advanced.ok) peer.results.push(advanced.value)
      else peer.failure = advanced.error
    }
    hostClock.adjust(stepMS)
  }
  const frames = (count: number, input?: (seat: number, at: number) => PlayerInput): void => {
    for (let at = 0; at < count; at++) frame(input === undefined ? undefined : (seat) => input(seat, at))
  }
  return { hostClock, peers, frame, frames }
}

type Match = ReturnType<typeof setUp>

/**
 * Plays a second of idle frames, so every guess since is right and no tick
 * runs again, then lets the peers behind catch up with the one ahead and
 * returns their checksums at that tick.
 */
const settle = (match: Match): ReadonlyArray<string> => {
  match.frames(60)
  const shown = match.peers.filter((peer) => !peer.visibility.hidden())
  for (let at = 0; at < 300; at++) {
    const ticks = match.peers.map((peer) => peer.session.status().tick)
    const lowest = Math.min(...shown.map((peer) => peer.session.status().tick))
    if (shown.every((peer) => peer.session.status().tick === lowest)) return shown.map(checksumOf)
    match.frame(undefined, (seat) => ticks[seat]! > lowest)
  }
  throw new Error("the peers never settled on one tick")
}

describe("hidden: \"stall\"", () => {
  it("waits for a hidden seat past timeoutMS, shows it in status().hidden, and goes on when it returns", () => {
    const match = setUp({ then: "stall", afterMS: 3000, timeoutMS: 1000 })
    const [host, guest] = match.peers
    match.frames(60, (seat, at) => pressed(seat, at))
    guest!.visibility.hide()
    // Twice timeoutMS of silence, within afterMS: the host waits.
    match.frames(120)
    expect(host!.failure).toBeUndefined()
    expect(host!.session.status().hidden).toEqual([false, true])
    expect(guest!.session.status().hidden).toEqual([false, true])
    expect(host!.results.at(-1)?._tag).toBe("Stalled")
    const stalledAt = host!.session.status().tick
    guest!.visibility.show()
    match.frames(60, (seat, at) => pressed(seat, at))
    expect(host!.failure).toBeUndefined()
    expect(guest!.failure).toBeUndefined()
    expect(host!.session.status().hidden).toEqual([false, false])
    expect(host!.session.status().tick).toBeGreaterThan(stalledAt + 30)
    // No resync: the hidden seat went on from where it stopped.
    expect(guest!.session.status().epoch).toBe(1)
    const [mine, theirs] = settle(match)
    expect(mine).toBe(theirs)
  })

  it("ends with Disconnected when the hidden seat stays silent past afterMS + timeoutMS, and lets go of the page", () => {
    const match = setUp({ then: "stall", afterMS: 2000, timeoutMS: 1000 })
    const [host, guest] = match.peers
    match.frames(30)
    guest!.visibility.hide()
    let frames = 0
    while (host!.failure === undefined && frames < 600) {
      match.frame()
      frames += 1
    }
    // Not before afterMS + timeoutMS, and soon after.
    expect(frames * stepMS).toBeGreaterThan(3000)
    expect(frames * stepMS).toBeLessThan(3100)
    expect(host!.failure).toMatchObject({ _tag: "Disconnected", seat: 1, reason: "timeout" })
    expect(host!.visibility.listeners()).toBe(0)
    expect(guest!.visibility.listeners()).toBe(1)
  })
})

describe("hidden: \"resync-on-return\"", () => {
  it("plays on without the hidden seat, and resyncs it on return so the worlds match", () => {
    const match = setUp({ then: "resync-on-return", afterMS: 5000 })
    const [host, guest] = match.peers
    match.frames(60, (seat, at) => pressed(seat, at))
    guest!.visibility.hide()
    const hiddenAt = host!.session.status().tick
    match.frames(120, (seat, at) => pressed(seat, at))
    // The host kept running, with idle input for seat 1.
    expect(host!.failure).toBeUndefined()
    expect(host!.session.status().tick).toBeGreaterThan(hiddenAt + 100)
    expect(host!.session.status().hidden).toEqual([false, true])
    expect(host!.session.rate()).toBe(1)
    guest!.visibility.show()
    // Until the host's save answers the return, the seat waits.
    match.frame()
    expect(guest!.results.at(-1)?._tag).toBe("Waiting")
    match.frames(30, (seat, at) => pressed(seat, at))
    expect(host!.session.status().epoch).toBe(2)
    expect(guest!.session.status().epoch).toBe(2)
    expect(guest!.results.at(-1)?._tag).toBe("Ran")
    match.frames(60, (seat, at) => pressed(seat, at))
    expect(host!.failure).toBeUndefined()
    expect(guest!.failure).toBeUndefined()
    const [mine, theirs] = settle(match)
    expect(mine).toBe(theirs)
    expect(host!.session.status().verified).toBeGreaterThan(host!.session.status().tick - 30)
  })

  it("keeps the other seats in agreement while one is away, over a lossy link", () => {
    const match = setUp({ then: "resync-on-return", afterMS: 5000, count: 3, loss: 0.1 })
    const [host, second, third] = match.peers
    // Seat 2 holds right as it hides: the others guessed that, and run again with idle input once they hear.
    const holding = (seat: number, at: number): PlayerInput => seat === 2 ? { dx: 1, fire: false } : pressed(seat, at)
    match.frames(60, holding)
    third!.visibility.hide()
    match.frames(150, (seat, at) => pressed(seat, at))
    for (const peer of [host!, second!]) {
      expect(peer.failure).toBeUndefined()
      expect(peer.session.status().hidden).toEqual([false, false, true])
      expect(peer.session.status().verified).toBeGreaterThan(150)
    }
    const [hostSum, secondSum] = settle(match)
    expect(hostSum).toBe(secondSum)
    third!.visibility.show()
    match.frames(90, (seat, at) => pressed(seat, at))
    for (const peer of match.peers) expect(peer.failure).toBeUndefined()
    const sums = settle(match)
    expect(new Set(sums).size).toBe(1)
  })

  it("plays on in lockstep too, with idle input for the hidden seat", () => {
    const match = setUp({ mode: "lockstep", then: "resync-on-return", afterMS: 5000 })
    const [host, guest] = match.peers
    match.frames(60, (seat, at) => pressed(seat, at))
    guest!.visibility.hide()
    const hiddenAt = host!.session.status().tick
    match.frames(120)
    expect(host!.session.status().tick).toBeGreaterThan(hiddenAt + 100)
    guest!.visibility.show()
    match.frames(60)
    const [mine, theirs] = settle(match)
    expect(mine).toBe(theirs)
  })

  it("waits for seat 0 instead: every save comes from its world", () => {
    const match = setUp({ then: "resync-on-return", afterMS: 5000 })
    const [host, guest] = match.peers
    match.frames(60)
    host!.visibility.hide()
    match.frames(120)
    expect(guest!.failure).toBeUndefined()
    expect(guest!.results.at(-1)?._tag).toBe("Stalled")
    expect(guest!.session.status().hidden).toEqual([true, false])
    host!.visibility.show()
    match.frames(30)
    expect(host!.session.status().epoch).toBe(1)
    const [mine, theirs] = settle(match)
    expect(mine).toBe(theirs)
  })
})

describe("hidden options", () => {
  it("rejects a negative afterMS, a policy it does not know, and a missing visibility", () => {
    const hostClock = HostClock.test()
    const links = MemoryNetworkLink.make({ peers: 2, hostClock, seed: 1, latencyMS: 0 })
    if (!links.ok) throw new Error(links.error.field)
    const make = (hidden: unknown) => {
      const peer = makePeer()
      const made = Netcode.rollback(peer.runtime, { simulate, seats: peer.seats, seat: 0, links: [links.value[0]!], hostClock, step, hidden: hidden as Netcode.HiddenOptions })
      return made.ok ? undefined : made.error.field
    }
    const visibility = MemoryVisibility.make()
    expect(make({ visibility, afterMS: -1, then: "stall" })).toBe("hidden.afterMS")
    expect(make({ visibility, afterMS: 0, then: "drop" })).toBe("hidden.then")
    expect(make({ afterMS: 0, then: "stall" })).toBe("hidden.visibility")
    expect(make({ visibility, afterMS: 0, then: "stall" })).toBeUndefined()
  })

  it("announces a page hidden from the start", () => {
    const hostClock = HostClock.test()
    const links = MemoryNetworkLink.make({ peers: 2, hostClock, seed: 1, latencyMS: 10 })
    if (!links.ok) throw new Error(links.error.field)
    const visibility = MemoryVisibility.make()
    visibility.hide()
    const sessions = [0, 1].map((seat) => {
      const peer = makePeer({ setUp: seat === 0 })
      const made = Netcode.rollback(peer.runtime, {
        simulate, seats: peer.seats, seat, links: [links.value[seat]!], hostClock, step,
        hidden: { visibility: seat === 1 ? visibility : MemoryVisibility.make(), afterMS: 1000, then: "stall" }
      })
      if (!made.ok) throw new Error(made.error.reason)
      return made.value
    })
    for (let at = 0; at < 30; at++) {
      for (const session of sessions) session.advance(idle)
      hostClock.adjust(stepMS)
    }
    expect(sessions[0]!.status().hidden).toEqual([false, true])
  })
})
