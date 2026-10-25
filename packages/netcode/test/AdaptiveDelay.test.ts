import { describe, expect, it } from "vitest"
import { HostClock } from "@typeonce/ritmo"
import { Netcode, NetworkLink } from "@typeonce/ritmo-netcode"

import { idle, makePeer, pressed, simulate, step } from "./game.ts"
import { checksumOf, frame, play, setUpMatch, truth } from "./match.ts"

const errorOf = <E>(result: { readonly ok: true } | { readonly ok: false; readonly error: E }): E | undefined => result.ok ? undefined : result.error

const expectAgreement = (match: ReturnType<typeof setUpMatch>) => {
  const sums = truth(match.peers, Math.max(...match.peers.map((peer) => peer.session.status().tick)))
  for (const peer of match.peers) expect(checksumOf(peer)).toBe(sums[peer.session.status().tick])
}

describe("adaptiveDelay", () => {
  it("holds max on a slow link, and rolls back less than a fixed delay of min", () => {
    // A one-way trip of about 5 ticks: the target is above max.
    const slow = { mode: "rollback", latencyMS: 80, jitterMS: 10, frames: 300 } as const
    const adaptive = play({ ...slow, adaptiveDelay: { min: 1, max: 4 } })
    const fixed = play({ ...slow, inputDelay: 1 })
    const total = (match: typeof adaptive, of: "rollbacks" | "again") => match.peers.reduce((sum, peer) => sum + peer.session.status()[of], 0)
    for (const peer of adaptive.peers) expect(peer.session.status()).toMatchObject({ inputDelay: 4, delayChanges: 0 })
    expect(total(adaptive, "rollbacks")).toBeLessThan(total(fixed, "rollbacks") * 0.6)
    expect(total(adaptive, "again")).toBeLessThan(total(fixed, "again"))
    expectAgreement(adaptive)
  })

  it("settles at min on a fast link", () => {
    const match = play({ mode: "rollback", latencyMS: 0, jitterMS: 0, adaptiveDelay: { min: 1, max: 4 } })
    for (const peer of match.peers) {
      expect(peer.session.status().inputDelay).toBe(1)
      expect(peer.session.status().delayChanges).toBe(1)
    }
    expectAgreement(match)
  })

  for (const mode of ["rollback", "lockstep"] as const) {
    it(`follows a link that gets slower and faster mid-match without a desync (${mode})`, () => {
      const match = setUpMatch({ mode, latencyMS: 5, jitterMS: 5, adaptiveDelay: { min: 1, max: 5 }, maxRollback: 10 })
      const delays = match.peers.map(() => new Set<number>())
      const setLatency = (latencyMS: number) => {
        for (const link of match.links) expect(link.setLatency(latencyMS).ok).toBe(true)
      }
      for (let at = 0; at < 900; at++) {
        if (at === 300) setLatency(110)
        if (at === 600) setLatency(30)
        frame(match, at, (seat) => at < 840 ? pressed(seat, at) : idle)
        for (const [seat, peer] of match.peers.entries()) delays[seat]!.add(peer.session.status().inputDelay)
      }
      for (const [seat, peer] of match.peers.entries()) {
        const status = peer.session.status()
        // Down to min on the fast link, up to max on the slow one, and down again in between.
        expect(delays[seat]).toContain(1)
        expect(delays[seat]).toContain(5)
        expect(status.inputDelay).toBeGreaterThan(1)
        expect(status.inputDelay).toBeLessThan(5)
        expect(status.delayChanges).toBeGreaterThanOrEqual(3)
        expect(status.verified).toBeGreaterThan(700)
      }
      expectAgreement(match)
    })
  }
})

describe("adaptiveDelay options", () => {
  const hostClock = HostClock.test()
  const link: NetworkLink.NetworkLink = { send: () => {}, receive: () => [], status: () => NetworkLink.open }

  it("starts at max", () => {
    const peer = makePeer()
    const session = Netcode.rollback(peer.runtime, { simulate, seats: peer.seats, seat: 0, links: [link], hostClock, step, adaptiveDelay: { min: 0, max: 3 } })
    expect(session.ok ? session.value.status() : undefined).toMatchObject({ inputDelay: 3, delayChanges: 0 })
  })

  it("rejects bounds out of order or below 0", () => {
    for (const bounds of [{ min: -1, max: 2 }, { min: 3, max: 2 }, { min: 1, max: 2.5 }]) {
      const peer = makePeer()
      const made = Netcode.lockstep(peer.runtime, { simulate, seats: peer.seats, seat: 0, links: [link], hostClock, step, adaptiveDelay: bounds })
      expect(errorOf(made)).toMatchObject({ _tag: "InvalidOptions", field: "adaptiveDelay", value: bounds })
    }
  })

  it("rejects inputDelay and adaptiveDelay together, when the types were bypassed", () => {
    const peer = makePeer()
    const both = { inputDelay: 2, adaptiveDelay: { min: 1, max: 4 } }
    // @ts-expect-error give inputDelay or adaptiveDelay, not both
    const made = Netcode.rollback(peer.runtime, { simulate, seats: peer.seats, seat: 0, links: [link], hostClock, step, ...both })
    expect(errorOf(made)).toMatchObject({ field: "adaptiveDelay", reason: "give inputDelay or adaptiveDelay, not both" })
  })
})
