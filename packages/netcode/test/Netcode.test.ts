import { describe, expect, it } from "vitest"
import { FixedLoop, HostClock } from "@typeonce/ritmo"
import { Desync } from "@typeonce/ritmo-devtools"
import { MemoryNetworkLink, Netcode, NetworkLink } from "@typeonce/ritmo-netcode"

import { drift, idle, makePeer, pressed, simulate, step } from "./game.ts"
import { checksumOf, frame, play, setUpMatch, stepMS, truth } from "./match.ts"

const valueOf = <A>(result: { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: unknown }): A => {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}
const errorOf = <E>(result: { readonly ok: true } | { readonly ok: false; readonly error: E }): E | undefined => result.ok ? undefined : result.error

const tagsOf = (results: ReadonlyArray<Netcode.Advanced>) => new Set(results.map((result) => result._tag))

describe("Netcode.rollback", () => {
  it("ends every peer on the world of one runtime that knew every input, after rolling back", () => {
    const match = play({ mode: "rollback", latencyMS: 60, jitterMS: 40 })
    for (const peer of match.peers) {
      const status = peer.session.status()
      expect(status.tick).toBeGreaterThan(300)
      expect(status.rollbacks).toBeGreaterThan(0)
      expect(status.again).toBeGreaterThan(status.rollbacks)
      expect(checksumOf(peer)).toBe(truth(match.peers, status.tick)[status.tick])
      expect(status.verified).toBeGreaterThan(200)
    }
  })

  it("reports in each advance the ticks its rollback ran again", () => {
    const match = play({ mode: "rollback", latencyMS: 60, jitterMS: 40 })
    for (const peer of match.peers) {
      const reported = peer.results.reduce((sum, result) => sum + (result._tag === "Ran" ? result.again : 0), 0)
      expect(peer.session.status().again).toBeGreaterThan(0)
      expect(reported).toBe(peer.session.status().again)
    }
  })

  it("agrees over a lossy link: inputs are sent again until acknowledged", () => {
    const match = play({ mode: "rollback", latencyMS: 40, jitterMS: 60, loss: 0.2, seed: 11 })
    for (const peer of match.peers) {
      const { tick } = peer.session.status()
      expect(checksumOf(peer)).toBe(truth(match.peers, tick)[tick])
    }
  })

  it("plays three seats through one relay", () => {
    const match = play({ mode: "rollback", count: 3, latencyMS: 30, jitterMS: 30 })
    const sums = truth(match.peers, Math.max(...match.peers.map((peer) => peer.session.status().tick)))
    for (const peer of match.peers) expect(checksumOf(peer)).toBe(sums[peer.session.status().tick])
  })

  it("rolls back many times inside a runtime window of exactly maxRollback checkpoints", () => {
    // Every rollback rewinds to a checkpoint the runtime keeps; running that tick again must not take a second one,
    // or the window covers fewer ticks than maxRollback after a few corrections and the session ends in CheckpointLost.
    const match = play({ mode: "rollback", count: 3, maxRollback: 8, checkpoints: 8, latencyMS: 30, jitterMS: 150, frames: 600, tail: 120 })
    const sums = truth(match.peers, Math.max(...match.peers.map((peer) => peer.session.status().tick)))
    for (const peer of match.peers) {
      const status = peer.session.status()
      expect(status.rollbacks).toBeGreaterThan(50)
      expect(checksumOf(peer)).toBe(sums[status.tick])
    }
  })

  it("waits for every seat before the first save, then starts every peer from seat 0's world", () => {
    const match = setUpMatch({ mode: "rollback", latencyMS: 20, jitterMS: 0 })
    // Seat 1 is not there yet: seat 0 waits.
    for (let at = 0; at < 10; at++) frame(match, at, () => idle, (seat) => seat === 1)
    expect(tagsOf(match.peers[0]!.results)).toEqual(new Set(["Waiting"]))
    for (let at = 10; at < 30; at++) frame(match, at, () => idle)
    const [host, guest] = match.peers
    expect(host!.session.status().epoch).toBe(1)
    expect(guest!.session.status().epoch).toBe(1)
    // Seat 1 never ran its setup: its world is seat 0's.
    const saved = guest!.runtime.snapshot()
    expect(saved.ok ? saved.value.entities.length : 0).toBe(2)
  })

  it("stalls when it would run past maxRollback, and drops the input", () => {
    const match = setUpMatch({ mode: "rollback", latencyMS: 0, jitterMS: 0, maxRollback: 4, inputDelay: 0 })
    for (let at = 0; at < 4; at++) frame(match, at, () => idle)
    // Seat 1 stops calling advance: seat 0 runs on guesses, then stalls.
    for (let at = 4; at < 20; at++) frame(match, at, () => idle, (seat) => seat === 1)
    const results = match.peers[0]!.results
    expect(results.at(-1)).toEqual({ _tag: "Stalled", input: undefined })
    expect(match.peers[0]!.session.status().tick - match.peers[0]!.session.status().confirmed).toBe(4)
  })

  it("slows the peer that runs ahead", () => {
    const match = setUpMatch({ mode: "rollback", latencyMS: 20, jitterMS: 0, maxRollback: 16 })
    for (let at = 0; at < 20; at++) frame(match, at, () => idle)
    // Seat 1's frames come at half the rate for a while: seat 0 gets ahead.
    for (let at = 20; at < 40; at++) frame(match, at, () => idle, (seat) => seat === 1 && at % 2 === 0)
    const [host, guest] = match.peers
    expect(host!.session.status().ahead).toBeGreaterThan(2)
    expect(host!.session.rate()).toBeLessThan(1)
    expect(host!.session.rate()).toBeGreaterThanOrEqual(0.9)
    expect(guest!.session.rate()).toBe(1)
  })

  it("stops on a desync until resync, which starts every peer from seat 0's world again", () => {
    const match = setUpMatch({ mode: "rollback", latencyMS: 30, jitterMS: 10 })
    for (let at = 0; at < 60; at++) frame(match, at, (seat) => pressed(seat, at))
    // Seat 1's world drifts outside the session.
    const [host, guest] = match.peers
    expect(guest!.runtime.tick(drift).ok).toBe(true)
    let failure: Netcode.SessionError<unknown> | undefined
    for (let at = 60; at < 200 && failure === undefined; at++) {
      for (const peer of match.peers) {
        const advanced = peer.session.advance(pressed(0, at))
        if (!advanced.ok) failure = advanced.error
      }
      match.hostClock.adjust(stepMS)
    }
    expect(failure?._tag).toBe("Desynced")
    // Still stopped.
    expect(guest!.session.advance(idle).ok || host!.session.advance(idle).ok).toBe(false)
    // Only seat 1 asks: seat 0 hosts the resync either way.
    guest!.session.resync()
    // Until seat 0's new save reaches it, a peer stays stopped.
    let stopped = 0
    for (let at = 200; at < 300; at++) {
      for (const peer of match.peers) if (!peer.session.advance(idle).ok) stopped += 1
      match.hostClock.adjust(stepMS)
    }
    expect(stopped).toBeGreaterThan(0)
    expect(stopped).toBeLessThan(20)
    expect(host!.session.status().epoch).toBe(2)
    expect(guest!.session.status().epoch).toBe(2)
    expect(host!.session.status().verified).toBeGreaterThan(0)
  })

  it("resyncs while inputs are in flight, and every peer agrees after it", () => {
    const match = setUpMatch({ mode: "rollback", latencyMS: 70, jitterMS: 50, seed: 3 })
    const [host, guest] = match.peers
    for (let at = 0; at < 60; at++) frame(match, at, (seat) => pressed(seat, at))
    // Seat 0 misses frames, so seat 1 runs ahead of it when the resync comes.
    for (let at = 60; at < 66; at++) frame(match, at, (seat) => pressed(seat, at), (seat) => seat === 0)
    const before = guest!.session.status().tick
    host!.session.resync()
    let epochTick: number | undefined
    for (let at = 66; at < 400; at++) {
      frame(match, at, (seat) => pressed(seat, at))
      if (epochTick === undefined && guest!.session.status().epoch === 2) epochTick = guest!.session.status().tick
    }
    // The peer ahead ran again up to where it was, from the save.
    expect(epochTick).toBeGreaterThanOrEqual(before)
    for (const peer of match.peers) expect(peer.session.status().verified).toBeGreaterThan(300)
  })

  it("starts every peer from the same data, where JSON changes a value", () => {
    // -0 is saved by seat 0 and arrives as 0: seat 0 restores what the others parse.
    const hostClock = HostClock.test()
    const links = valueOf(MemoryNetworkLink.make({ peers: 2, hostClock, seed: 1, latencyMS: 16 }))
    const peers = [makePeer({ drift: -0 }), makePeer({ setUp: false })]
    const sessions = peers.map((peer, seat) => valueOf(Netcode.rollback(peer.runtime, {
      simulate, seats: peer.seats, seat, links: [links[seat]!], hostClock, step, checksumEvery: 5
    })))
    for (let at = 0; at < 60; at++) {
      for (const session of sessions) expect(errorOf(session.advance(idle))).toBeUndefined()
      hostClock.adjust(stepMS)
    }
    expect(sessions[0]!.status().verified).toBeGreaterThan(40)
  })

  it("keeps the save of a disagreeing tick when asked", () => {
    const hostClock = HostClock.test()
    const links = valueOf(MemoryNetworkLink.make({ peers: 2, hostClock, seed: 1, latencyMS: 16 }))
    const peers = [makePeer(), makePeer({ setUp: false })]
    const sessions = peers.map((peer, seat) => valueOf(Netcode.rollback(peer.runtime, {
      simulate, seats: peer.seats, seat, links: [links[seat]!], hostClock, step, keepSnapshots: true, checksumEvery: 5
    })))
    for (let at = 0; at < 20; at++) {
      for (const session of sessions) session.advance(idle)
      hostClock.adjust(stepMS)
    }
    peers[1]!.runtime.tick(drift)
    let failure: Netcode.SessionError<unknown> | undefined
    for (let at = 20; at < 60 && failure === undefined; at++) {
      for (const session of sessions) {
        const advanced = session.advance(idle)
        if (!advanced.ok) failure ??= advanced.error
      }
      hostClock.adjust(stepMS)
    }
    expect(failure?._tag).toBe("Desynced")
    if (failure?._tag !== "Desynced") return
    // The other peer stops on the same tick, with its own save: comparing them names what went apart.
    let theirs: Netcode.Desynced | undefined
    for (let at = 0; at < 20 && theirs === undefined; at++) {
      for (const session of sessions) {
        const advanced = session.advance(idle)
        if (!advanced.ok && advanced.error._tag === "Desynced" && advanced.error.tick === failure.tick && advanced.error.mine !== failure.mine) theirs = advanced.error
      }
      hostClock.adjust(stepMS)
    }
    const compared = Desync.compare(failure.snapshot!, theirs!.snapshot!)
    expect(compared.data.map((difference) => difference.path)).toContain("resource NetTest/Drift")
  })

  it("ends with Disconnected when a seat goes quiet, or a link closes", () => {
    const quiet = setUpMatch({ mode: "rollback", latencyMS: 10, jitterMS: 0 })
    for (let at = 0; at < 10; at++) frame(quiet, at, () => idle)
    for (let at = 0; at < 400; at++) {
      const advanced = quiet.peers[0]!.session.advance(idle)
      quiet.hostClock.adjust(stepMS)
      if (!advanced.ok) {
        expect(advanced.error).toMatchObject({ _tag: "Disconnected", seat: 1, reason: "timeout" })
        break
      }
      expect(at).toBeLessThan(330)
    }
    const closed = setUpMatch({ mode: "rollback", latencyMS: 10, jitterMS: 0 })
    for (let at = 0; at < 10; at++) frame(closed, at, () => idle)
    closed.links[0]!.close("left the room")
    const advanced = closed.peers[0]!.session.advance(idle)
    expect(advanced.ok ? undefined : advanced.error).toEqual({ _tag: "Disconnected", seat: undefined, reason: "closed", detail: "left the room" })
    // The session stays ended.
    expect(closed.peers[0]!.session.advance(idle).ok).toBe(false)
  })

  it("counts messages it cannot parse, and ends on another protocol version", () => {
    const hostClock = HostClock.test()
    const inbox: Array<string> = []
    const link: NetworkLink.NetworkLink = { send: () => {}, receive: () => inbox.splice(0), status: () => NetworkLink.open }
    const peer = makePeer()
    const session = valueOf(Netcode.rollback(peer.runtime, { simulate, seats: peer.seats, seat: 0, links: [link], hostClock, step }))
    inbox.push("not json", JSON.stringify({ v: 2, k: "hello", from: 7, epoch: 0 }))
    expect(session.advance(idle).ok).toBe(true)
    expect(session.status().dropped).toBe(2)
    inbox.push(JSON.stringify({ v: 1, k: "hello", from: 1, epoch: 0 }))
    const advanced = session.advance(idle)
    expect(advanced.ok ? undefined : advanced.error).toEqual({ _tag: "ProtocolMismatch", version: 1 })
  })
})

describe("Netcode.lockstep", () => {
  it("ends every peer on the reference world without running anything again", () => {
    const match = play({ mode: "lockstep", latencyMS: 60, jitterMS: 40 })
    for (const peer of match.peers) {
      const status = peer.session.status()
      expect(status.rollbacks).toBe(0)
      expect(checksumOf(peer)).toBe(truth(match.peers, status.tick)[status.tick])
      expect(tagsOf(peer.results).has("Stalled")).toBe(true)
    }
  })
})

describe("Netcode options", () => {
  const hostClock = HostClock.test()
  const link: NetworkLink.NetworkLink = { send: () => {}, receive: () => [], status: () => NetworkLink.open }

  it("rejects a seat out of range, seats the runtime does not provide, and seats taken by another session", () => {
    const peer = makePeer()
    const other = makePeer()
    expect(errorOf(Netcode.rollback(peer.runtime, { simulate, seats: peer.seats, seat: 2, links: [link], hostClock, step }))).toMatchObject({ field: "seat" })
    expect(errorOf(Netcode.rollback(peer.runtime, { simulate, seats: other.seats, seat: 0, links: [link], hostClock, step }))).toMatchObject({ field: "seats" })
    expect(Netcode.rollback(peer.runtime, { simulate, seats: peer.seats, seat: 0, links: [link], hostClock, step }).ok).toBe(true)
    expect(errorOf(Netcode.lockstep(peer.runtime, { simulate, seats: peer.seats, seat: 0, links: [link], hostClock, step }))).toMatchObject({
      field: "seats",
      reason: expect.stringContaining("already belong to a session")
    })
  })

  it("rejects a maxRollback the runtime's checkpoints cannot cover", () => {
    const peer = makePeer({ checkpoints: 4 })
    const made = Netcode.rollback(peer.runtime, { simulate, seats: peer.seats, seat: 0, links: [link], hostClock, step, maxRollback: 8 })
    expect(errorOf(made)).toMatchObject({ field: "maxRollback", reason: expect.stringContaining("checkpoints") })
  })

  it("rejects seats with fewer than two players, or an idle input the schema rejects", () => {
    const schema = makePeer().seats
    expect(schema.count).toBe(2)
    const bad = Netcode.seats({ "~standard": { version: 1, vendor: "test", validate: () => ({ issues: [{ message: "no" }] }) } }, { count: 2, idle: 0 })
    expect(errorOf(bad)).toMatchObject({ field: "idle", reason: expect.stringContaining("no") })
  })
})

describe("session.update", () => {
  it("drives a FixedLoop, answers a halt with one report and a resync, and stops once the session ends", () => {
    const match = setUpMatch({ mode: "rollback", latencyMS: 20, jitterMS: 0 })
    const halts: Array<Netcode.Halted<unknown>> = []
    const failures: Array<FixedLoop.Failure<Netcode.Ended>> = []
    const ticks: Array<(tick: FixedLoop.Tick) => void> = []
    for (const peer of match.peers) {
      const loop = FixedLoop.start({
        source: FixedLoop.source((onTick) => {
          ticks.push(onTick)
          return { stop: () => {} }
        }),
        step,
        maxFrameSeconds: 0.25,
        maxStepsPerFrame: 1,
        rate: peer.session.rate,
        update: peer.session.update({ input: () => idle, onHalted: (error) => halts.push(error) }),
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
    match.peers[1]!.runtime.tick(drift)
    run(120)
    expect(halts.map((halt) => halt._tag)).toContain("Desynced")
    // Each halt is reported once, and the resync starts the peers again.
    expect(halts.length).toBeLessThanOrEqual(2)
    expect(match.peers[0]!.session.status().epoch).toBe(2)
    expect(failures).toEqual([])
    // Seat 0 leaves: its loop stops with the end; seat 1 would notice on its timeout.
    match.links[0]!.close("gone")
    run(2)
    expect(failures.map((failure) => failure.kind === "UpdateFailure" ? failure.error._tag : failure.kind)).toEqual(["Disconnected"])
  })
})
