import { describe, expect, it } from "vitest"
import { FixedLoop } from "@typeonce/ritmo"
import { Netcode } from "@typeonce/ritmo-netcode"

import { idle, pressed, step, type PlayerInput } from "./game.ts"
import { checksumOf, flaky, playOn, reference, reload, setUpMatch, settleOn, staying, stepMS, type MatchPeer } from "./match.ts"

type Match = ReturnType<typeof setUpMatch>

/** A seat without a driver fires on every tick, so the world shows the tick it left on. */
const left: PlayerInput = { dx: 2, fire: true }

/** `seat` quits on purpose: its session leaves, and its page advances no more. */
const quit = (match: Match, seat: number): void => {
  match.peers[seat]!.session.leave()
  match.departed.add(seat)
}

/** Frames until every staying peer names `seat` as left. */
const framesUntilOut = (match: Match, seat: number, most: number): number => {
  for (let at = 0; at < most; at++) {
    if (staying(match).every((peer) => peer.session.status().left[seat] !== undefined)) return at
    playOn(match, 1)
  }
  throw new Error(`seat ${seat} was not out after ${most} frames`)
}

/** Every staying peer names the same seats as left, and holds the world of one runtime that knew every input. */
const expectAgreement = (match: Match) => {
  const peers = staying(match)
  const out = peers[0]!.session.status().left
  for (const peer of peers) expect(peer.session.status().left).toEqual(out)
  const sums = reference(match.peers, Math.max(...peers.map((peer) => peer.session.status().tick)), out, match.options.left).sums
  for (const peer of peers) expect(checksumOf(peer)).toBe(sums[peer.session.status().tick])
  return out
}

const endedWith = (peer: MatchPeer) => {
  const advanced = peer.session.advance(idle)
  return advanced.ok ? undefined : advanced.error
}

describe("session.leave", () => {
  for (const mode of ["rollback", "lockstep"] as const) {
    it(`puts the seat out on every peer at once, with "left", and they play on (${mode})`, () => {
      // timeoutMS is the default five seconds: the others must not wait for it.
      const match = setUpMatch({ mode, count: 4, latencyMS: 40, jitterMS: 20, checksumEvery: 10, left })
      playOn(match, 90)
      quit(match, 2)
      // About one round trip, far inside timeoutMS.
      expect(framesUntilOut(match, 2, 30) * stepMS).toBeLessThan(500)
      for (const peer of staying(match)) expect(peer.session.status().left[2]?.reason).toBe("left")
      playOn(match, 120)
      settleOn(match)
      expect(match.halts).toEqual([])
      const out = expectAgreement(match)
      expect(out.map((one) => one?.reason)).toEqual([undefined, undefined, "left", undefined])
      // No save was needed: the match went on in its first epoch.
      for (const peer of staying(match)) expect(peer.session.status().epoch).toBe(1)
      // The seat that left is ended, for good.
      const ended = { _tag: "Disconnected", who: "self", seat: 2, reason: "left" }
      expect(endedWith(match.peers[2]!)).toMatchObject(ended)
      expect(endedWith(match.peers[2]!)).toMatchObject(ended)
    })
  }

  it("reaches every peer over a lossy link (8 seats)", { timeout: 30_000 }, () => {
    const match = setUpMatch({ mode: "rollback", count: 8, seed: 5, latencyMS: 50, jitterMS: 40, loss: 0.1, maxRollback: 24, checkpoints: 24, checksumEvery: 10, left })
    playOn(match, 120)
    quit(match, 5)
    expect(framesUntilOut(match, 5, 120) * stepMS).toBeLessThan(2000)
    playOn(match, 120)
    settleOn(match)
    expect(match.halts).toEqual([])
    expect(expectAgreement(match).map((one) => one?.reason)).toEqual([undefined, undefined, undefined, undefined, undefined, "left", undefined, undefined])
  })

  it("hands the match to the next seat when the host leaves", () => {
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 30, jitterMS: 10, checksumEvery: 10, left })
    playOn(match, 90)
    quit(match, 0)
    expect(framesUntilOut(match, 0, 30) * stepMS).toBeLessThan(500)
    playOn(match, 60)
    settleOn(match)
    expect(match.halts).toEqual([])
    expect(expectAgreement(match)[0]?.reason).toBe("left")
    // Seat 1 hosts now: it answers a resync.
    match.peers[2]!.session.resync()
    playOn(match, 120)
    settleOn(match)
    expect(match.halts).toEqual([])
    for (const peer of staying(match)) expect(peer.session.status().epoch).toBe(2)
    expect(new Set(staying(match).map(checksumOf)).size).toBe(1)
  })

  it("reaches a peer that missed the bye, through the others' reports", () => {
    const { down, wrap } = flaky()
    const match = setUpMatch({ mode: "rollback", count: 4, latencyMS: 40, jitterMS: 0, checksumEvery: 10, left, wrap })
    playOn(match, 90)
    // Seat 3 hears nothing while the host's bye is on its way: it learns from seats 1 and 2, which do not decide for it.
    down.add(3)
    quit(match, 0)
    playOn(match, 5)
    down.delete(3)
    expect(match.peers[3]!.session.status().left[0]).toBeUndefined()
    expect(framesUntilOut(match, 0, 60) * stepMS).toBeLessThan(1000)
    playOn(match, 60)
    settleOn(match)
    expect(match.halts).toEqual([])
    expect(expectAgreement(match).map((one) => one?.reason)).toEqual(["left", undefined, undefined, undefined])
  })

  it("ends the last other seat's session, naming the seat that left", () => {
    const match = setUpMatch({ mode: "lockstep", latencyMS: 20, jitterMS: 0 })
    playOn(match, 30)
    quit(match, 1)
    playOn(match, 5)
    expect(match.ended.get(0)).toMatchObject({ _tag: "Disconnected", who: "others", seat: 1, reason: "left" })
  })

  it("is idempotent, and lets go of the visibility", () => {
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 20, jitterMS: 0, hidden: { afterMS: 1000, then: "stall" } })
    playOn(match, 60)
    const peer = match.peers[1]!
    expect(peer.visibility.listeners()).toBe(1)
    const before = peer.session.status().sent.messages
    peer.session.leave()
    const after = peer.session.status().sent.messages
    // Its last messages go out at once, in a few bundles against loss.
    expect(after).toBeGreaterThan(before)
    expect(peer.visibility.listeners()).toBe(0)
    // A second leave sends nothing and changes nothing; a hide is not heard.
    peer.session.leave()
    peer.visibility.hide()
    expect(peer.session.status().sent.messages).toBe(after)
    expect(peer.session.status().hidden[1]).toBe(false)
    match.departed.add(1)
    playOn(match, 30)
    expect(match.halts).toEqual([])
    for (const one of staying(match)) expect(one.session.status().left[1]?.reason).toBe("left")
  })

  it("stops the FixedLoop that update drives, with the ended error", () => {
    const match = setUpMatch({ mode: "rollback", latencyMS: 20, jitterMS: 0 })
    const failures: Array<FixedLoop.Failure<Netcode.Ended>> = []
    const ticks: Array<(tick: FixedLoop.Tick) => void> = []
    let steps = 0
    for (const peer of match.peers) {
      const update = peer.session.update({ input: () => idle, onHalted: () => {} })
      const loop = FixedLoop.start({
        source: FixedLoop.source((onTick) => {
          ticks.push(onTick)
          return { stop: () => {} }
        }),
        step,
        maxFrameSeconds: 0.25,
        maxStepsPerFrame: 1,
        update: (seconds, at) => {
          steps += 1
          return update(seconds, at)
        },
        render: () => {},
        onFailure: (failure) => failures.push(failure)
      })
      expect(loop.ok).toBe(true)
    }
    const run = (frames: number) => {
      for (let at = 0; at < frames; at++) {
        for (const tick of ticks) tick({ deltaMS: stepMS })
        match.hostClock.adjust(stepMS)
      }
    }
    run(60)
    match.peers[1]!.session.leave()
    run(1)
    const reasons = () => failures.map((failure) => failure.kind === "UpdateFailure" && failure.error._tag === "Disconnected" ? [failure.error._tag, failure.error.who, failure.error.reason] : [failure.kind])
    // Seat 1's loop stops on its next step; seat 0, the last one left, ends too.
    expect(reasons()).toContainEqual(["Disconnected", "self", "left"])
    run(5)
    expect(reasons()).toEqual([["Disconnected", "self", "left"], ["Disconnected", "others", "left"]])
    const before = steps
    run(5)
    expect(steps).toBe(before)
  })

  it("before the match starts, ends the session, and seat 0 waits for a new one of the seat", () => {
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 20, jitterMS: 0 })
    // Seat 2 says hello once and leaves in the same frame: seat 0 hears both before it could start.
    playOn(match, 1, { skip: (seat) => seat !== 2 })
    quit(match, 2)
    expect(endedWith(match.peers[2]!)).toMatchObject({ _tag: "Disconnected", who: "self", seat: 2, reason: "left" })
    playOn(match, 60)
    expect(match.halts).toEqual([])
    for (const peer of staying(match)) {
      expect(peer.session.status().epoch).toBe(0)
      expect(peer.session.status().left).toEqual([undefined, undefined, undefined])
    }
    // The lobby seats someone again: a new session of seat 2 starts the match.
    match.departed.delete(2)
    reload(match, 2)
    playOn(match, 60, { input: pressed })
    settleOn(match)
    expect(match.halts).toEqual([])
    for (const peer of match.peers) expect(peer.session.status().epoch).toBe(1)
    expect(new Set(match.peers.map(checksumOf)).size).toBe(1)
  })
})
