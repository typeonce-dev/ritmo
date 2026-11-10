import { describe, expect, it } from "vitest"

import { idle, pressed } from "./game.ts"
import { checksumOf, frame, playOn, setUpMatch, settleOn } from "./match.ts"

/** A message seat 1's link carries to seat 0, written by hand. */
const inputs = (start: number, length: number) =>
  JSON.stringify({ v: 3, k: "inputs", from: 1, epoch: 1, next: -1, acks: [-1, -1], start, inputs: Array.from({ length }, () => idle) })
const sum = (tick: number, text: string) => JSON.stringify({ v: 3, k: "sum", from: 1, epoch: 1, tick, sum: text })

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
   * Three seats over a slow, jittery link that loses messages, with a deep
   * rollback window. In `"resync"`, seat 0 hitches while the others run as
   * far ahead as they may, then resyncs. In `"hidden"`, seat 2 hides for ten
   * seconds, longer than any window, and returns to a save.
   */
  const playHonest = (mode: "rollback" | "lockstep", delay: (typeof delays)[number]["delay"], scenario: "resync" | "hidden") => {
    const match = setUpMatch({
      mode, count: 3, seed: 11, latencyMS: 250, jitterMS: 200, loss: 0.1, maxRollback: 60, checkpoints: 60, checksumEvery: 10, ...delay,
      hidden: { afterMS: 10_000, then: "resync-on-return" }
    })
    playOn(match, 200)
    if (scenario === "resync") {
      playOn(match, 100, { skip: (seat) => seat === 0 })
      match.peers[0]!.session.resync()
    } else {
      match.peers[2]!.visibility.hide()
      playOn(match, 600)
      match.peers[2]!.visibility.show()
    }
    playOn(match, 150)
    settleOn(match)
    return match
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
