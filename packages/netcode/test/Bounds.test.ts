import { describe, expect, it } from "vitest"
import { HostClock } from "@typeonce/ritmo"
import { MemoryNetworkLink, MemoryVisibility, Netcode } from "@typeonce/ritmo-netcode"

import { idle, makePeer, pressed, simulate, step } from "./game.ts"
import { checksumOf, frame, setUpMatch, stepMS } from "./match.ts"

/** A message seat 1's link carries to seat 0, written by hand. */
const inputs = (start: number, length: number) =>
  JSON.stringify({ v: 2, k: "inputs", from: 1, epoch: 1, next: -1, acks: [-1, -1], start, inputs: Array.from({ length }, () => idle) })
const sum = (tick: number, text: string) => JSON.stringify({ v: 2, k: "sum", from: 1, epoch: 1, tick, sum: text })

describe("what a peer stores for another", () => {
  it("drops inputs and checksums no honest peer sends, and plays on", () => {
    const match = setUpMatch({ mode: "rollback", latencyMS: 0, jitterMS: 0 })
    const [host] = match.peers
    let at = 0
    for (; at < 30; at++) frame(match, at, () => idle)
    expect(host!.session.status().dropped).toBe(0)
    for (let n = 0; n < 40; n++, at++) {
      // More inputs than a message carries, and a checksum longer than a checksum: malformed.
      match.links[1]!.send(inputs(1_000_000 + n * 5_000, 5_000))
      match.links[1]!.send(sum(9_000_000 + n, "x".repeat(1_000)))
      // Well formed, for ticks further ahead than an honest peer can be.
      match.links[1]!.send(inputs(1_000_000 + n * 64, 64))
      match.links[1]!.send(sum(9_000_000 + n, "0123456789abcdef"))
      frame(match, at, (seat) => pressed(seat, at))
    }
    expect(host!.session.status().dropped).toBe(160)
    for (let n = 0; n < 120; n++, at++) frame(match, at, () => idle)
    const [mine, theirs] = match.peers.map((peer) => peer.session.status())
    expect(mine!.tick).toBeGreaterThan(150)
    expect(mine!.verified).toBeGreaterThan(mine!.tick - 40)
    expect(theirs!.dropped).toBe(0)
  })

  const delays = [
    { name: "a long adaptive delay", delay: { adaptiveDelay: { min: 0, max: 30 } } },
    { name: "no input delay", delay: { inputDelay: 0 } }
  ] as const
  /**
   * Three seats over a slow link with a deep rollback window. In
   * `"resync"`, the link loses messages, seat 0 hitches while the others
   * run as far ahead as they may, then resyncs. In `"hidden"`, seat 2 hides
   * for ten seconds, longer than any window, and returns to a save. The
   * link keeps messages in order, and `"hidden"` loses none: jitter and
   * loss there reach other bugs than what a peer stores (seat 0's inputs
   * overtaking its save, a lost hide announcement, a desync when a seat
   * hides under a long delay).
   */
  const playHonest = (mode: "rollback" | "lockstep", delay: (typeof delays)[number]["delay"], scenario: "resync" | "hidden") => {
    const count = 3
    const maxRollback = 60
    const hostClock = HostClock.test()
    const links = MemoryNetworkLink.make({ peers: count, hostClock, seed: 11, latencyMS: 250, jitterMS: 0, loss: scenario === "resync" ? 0.1 : 0 })
    if (!links.ok) throw new Error(links.error.field)
    const peers = Array.from({ length: count }, (_, seat) => {
      const peer = makePeer({ count, setUp: seat === 0, checkpoints: maxRollback })
      const visibility = MemoryVisibility.make()
      const shared = {
        simulate,
        seats: peer.seats,
        seat,
        links: [links.value[seat]!],
        hostClock,
        step,
        checksumEvery: 10,
        ...delay,
        hidden: { visibility, afterMS: 10_000, then: "resync-on-return" as const }
      }
      const session = mode === "rollback" ? Netcode.rollback(peer.runtime, { ...shared, maxRollback }) : Netcode.lockstep(peer.runtime, shared)
      if (!session.ok) throw new Error(session.error.reason)
      return { ...peer, visibility, session: session.value }
    })
    const halts: Array<string> = []
    const play = (frames: number, skip: (seat: number) => boolean = () => false, input = pressed) => {
      for (let at = 0; at < frames; at++) {
        for (const [seat, peer] of peers.entries()) {
          if (peer.visibility.hidden() || skip(seat)) continue
          const advanced = peer.session.advance(input(seat, at))
          if (!advanced.ok) halts.push(`seat ${seat}: ${advanced.error._tag}`)
        }
        hostClock.adjust(stepMS)
      }
    }
    play(200)
    if (scenario === "resync") {
      play(100, (seat) => seat === 0)
      peers[0]!.session.resync()
    } else {
      peers[2]!.visibility.hide()
      play(600)
      peers[2]!.visibility.show()
    }
    play(150)
    // Idle until every guess is right, then every seat on one tick.
    play(90, undefined, () => idle)
    for (let at = 0; at < 600; at++) {
      const ticks = peers.map((peer) => peer.session.status().tick)
      const lowest = Math.min(...ticks)
      if (ticks.every((tick) => tick === lowest)) break
      for (const [seat, peer] of peers.entries()) {
        if (ticks[seat] !== lowest) continue
        const advanced = peer.session.advance(idle)
        if (!advanced.ok) halts.push(`seat ${seat}: ${advanced.error._tag}`)
      }
      hostClock.adjust(stepMS)
    }
    return { peers, halts }
  }
  for (const mode of ["rollback", "lockstep"] as const) for (const { name, delay } of delays) for (const scenario of ["resync", "hidden"] as const) {
    it(`drops nothing an honest match sends: ${scenario}, a deep rollback window and ${name} (${mode})`, () => {
      const { peers, halts } = playHonest(mode, delay, scenario)
      expect(halts).toEqual([])
      expect(peers.map((peer) => peer.session.status().dropped)).toEqual([0, 0, 0])
      expect(peers.map((peer) => peer.session.status().epoch)).toEqual([2, 2, 2])
      if (mode === "rollback") expect(peers.some((peer) => peer.session.status().rollbacks > 0)).toBe(true)
      expect(new Set(peers.map((peer) => peer.session.status().tick)).size).toBe(1)
      expect(new Set(peers.map(checksumOf)).size).toBe(1)
    })
  }
})
