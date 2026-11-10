/**
 * Seeded matches over a faulty link with hides, hitches and resyncs mixed:
 * whatever the seed, no peer halts or times out, and every peer ends on one
 * world. A failing seed fails the same way again: replay it alone.
 */
import { describe, expect, it } from "vitest"
import { Random } from "@typeonce/ritmo"

import { checksumOf, playOn, setUpMatch, settleOn } from "./match.ts"

/** Seeds per case. A longer local run raises it. */
const seeds = 3

const soak = (mode: "rollback" | "lockstep", count: number, seed: number) => {
  const random = Random.make(seed * 7919 + count * 31 + (mode === "rollback" ? 0 : 1))
  const then = random.next() < 0.5 ? "resync-on-return" as const : "stall" as const
  const match = setUpMatch({
    mode,
    count,
    seed,
    latencyMS: random.integer(20, 250),
    jitterMS: random.integer(0, 200),
    loss: random.integer(0, 11) / 100,
    ...(random.next() < 0.5 ? { inputDelay: random.integer(0, 31) } : { adaptiveDelay: { min: 0, max: random.integer(2, 31) } }),
    maxRollback: 60,
    checkpoints: 60,
    checksumEvery: 10,
    hidden: { afterMS: 10_000, then }
  })
  const script: Array<string> = [`${then}`]
  playOn(match, 120)
  /** Per seat, the frames left until its hitch ends, and until its page shows again (well within `afterMS`). */
  const hitched: Array<number> = Array.from({ length: count }, () => 0)
  const hidden: Array<number> = Array.from({ length: count }, () => 0)
  for (let phase = 0; phase < 10; phase++) {
    const event = random.integer(0, 4)
    const seat = random.integer(0, count)
    if (event === 0 && hidden[seat] === 0) {
      script.push(`${seat} hides`)
      hidden[seat] = random.integer(30, 480)
      match.peers[seat]!.visibility.hide()
    } else if (event === 1) {
      script.push(`${seat} hitches`)
      hitched[seat] = random.integer(10, 100)
    } else if (event === 2) {
      script.push(`${seat} resyncs`)
      match.peers[seat]!.session.resync()
    }
    const frames = random.integer(60, 240)
    for (let at = 0; at < frames; at++) {
      playOn(match, 1, { skip: (other) => hitched[other]! > 0 })
      for (let other = 0; other < count; other++) {
        hitched[other] = Math.max(0, hitched[other]! - 1)
        if (hidden[other]! > 0 && --hidden[other]! === 0) match.peers[other]!.visibility.show()
      }
    }
  }
  for (const peer of match.peers) peer.visibility.show()
  playOn(match, 240)
  settleOn(match)
  return { match, script }
}

/**
 * Seeds a longer run found, each a bug of its own: a seat back from a hide
 * sent checksums of ticks it ran on guesses while it waited for its save
 * (rollback); a peer had run past a save's floor with the inputs a hiding
 * seat sent before that save, which the others then left idle (lockstep);
 * all three copies of a hide announcement were lost, with no third peer
 * to pass it on; seat 0 hid before its save reached a peer, which held the
 * announcement for that save and timed seat 0 out meanwhile.
 */
const found = [
  { mode: "rollback", count: 3, seed: 153 },
  { mode: "lockstep", count: 3, seed: 71 },
  { mode: "lockstep", count: 2, seed: 113 },
  { mode: "lockstep", count: 2, seed: 200 }
] as const

describe("a seeded soak", () => {
  for (const { mode, count, seed } of found) {
    it(`never halts and ends on one world: seed ${seed} found by a longer run, ${count} seats (${mode})`, { timeout: 30_000 }, () => {
      const { match, script } = soak(mode, count, seed)
      const label = script.join(", ")
      expect(match.halts, label).toEqual([])
      expect(new Set(match.peers.map(checksumOf)).size, label).toBe(1)
    })
  }
  for (const mode of ["rollback", "lockstep"] as const) for (const count of [2, 3]) for (let seed = 1; seed <= seeds; seed++) {
    // A deep rollback window runs many ticks again: a loaded machine needs more than the default timeout.
    it(`never halts and ends on one world: seed ${seed}, ${count} seats (${mode})`, { timeout: 30_000 }, () => {
      const { match, script } = soak(mode, count, seed)
      const label = script.join(", ")
      expect(match.halts, label).toEqual([])
      expect(new Set(match.peers.map((peer) => peer.session.status().epoch)).size, label).toBe(1)
      expect(new Set(match.peers.map((peer) => peer.session.status().tick)).size, label).toBe(1)
      expect(new Set(match.peers.map(checksumOf)).size, label).toBe(1)
    })
  }
})
