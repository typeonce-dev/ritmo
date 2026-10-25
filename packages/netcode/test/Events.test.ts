import { describe, expect, it } from "vitest"
import { Netcode } from "@typeonce/ritmo-netcode"

import { Fired, idle, pressed, type PlayerInput } from "./game.ts"
import { frame, reference, setUpMatch, type MatchPeer } from "./match.ts"

type Step = "predicted" | "withdrawn" | "confirmed"

/**
 * A host reader of `Fired` that checks every read against the streams'
 * rules, and keeps what happened to each tick. It reads in the order a
 * careless host would: confirmed, predicted, then withdrawn.
 */
const watch = (peer: MatchPeer) => {
  const reader = peer.session.events(Fired)
  const history = new Map<number, Array<Step>>()
  const note = (tick: number, step: Step) => {
    const steps = history.get(tick) ?? []
    if (steps.at(-1) !== step) steps.push(step)
    history.set(tick, steps)
  }
  /** Ticks handed out as predicted and not withdrawn or confirmed since. */
  const outstanding = new Set<number>()
  const confirmed: Array<Netcode.EventRecord<{ readonly seat: number; readonly x: number }>> = []
  const read = () => {
    const settled = reader.confirmed()
    for (const record of settled) {
      // Oldest first, and never a tick handed out before.
      expect(record.tick).toBeGreaterThanOrEqual(confirmed.at(-1)?.tick ?? -1)
      if (confirmed.at(-1)?.tick !== record.tick) expect(history.get(record.tick)?.includes("confirmed") ?? false).toBe(false)
      confirmed.push(record)
      outstanding.delete(record.tick)
      note(record.tick, "confirmed")
    }
    const predicted = reader.predicted()
    const fresh = new Set(predicted.map((record) => record.tick))
    for (const tick of fresh) {
      // Each run of a tick once, and never one already confirmed.
      expect(outstanding.has(tick)).toBe(false)
      expect(history.get(tick)?.includes("confirmed") ?? false).toBe(false)
      outstanding.add(tick)
      note(tick, "predicted")
    }
    const withdrawn = reader.withdrawn()
    for (const { tick } of withdrawn) {
      // Only ticks it handed out as predicted, and never the run it just handed out.
      expect(fresh.has(tick)).toBe(false)
      expect(history.get(tick)?.includes("predicted") ?? false).toBe(true)
      outstanding.delete(tick)
      note(tick, "withdrawn")
    }
    return { predicted, withdrawn: withdrawn.map(({ tick }) => tick) }
  }
  return { reader, history, outstanding, confirmed, read }
}

describe("session.events", () => {
  it("under rollback, hands out a rolled-back tick as predicted, withdraws it, predicts it again, and confirms it once", () => {
    // Three seats: one seat's input can correct a guess while another's is still missing, so the tick runs again unconfirmed.
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 60, jitterMS: 40 })
    const watchers = match.peers.map(watch)
    for (let at = 0; at < 600 + 90; at++) {
      frame(match, at, (seat) => at < 600 ? pressed(seat, at) : idle)
      for (const watcher of watchers) watcher.read()
    }
    for (const [seat, peer] of match.peers.entries()) {
      const watcher = watchers[seat]!
      const status = peer.session.status()
      expect(status.rollbacks).toBeGreaterThan(0)
      const settled = Math.min(status.confirmed, status.tick)
      // Confirmed: exactly the events of a runtime that knew every input, each once.
      expect(watcher.confirmed).toEqual(reference(match.peers, settled).fired.filter(({ tick }) => tick < settled))
      expect(watcher.confirmed.length).toBeGreaterThan(50)
      expect(watcher.outstanding.size).toBe(0)
    }
    const steps = new Set(watchers.flatMap((watcher) => [...watcher.history.values()].map((steps) => steps.join(" "))))
    // Ran again with other events while still unconfirmed: withdrawn, handed out again, then confirmed.
    expect([...steps].some((line) => line.startsWith("predicted withdrawn predicted") && line.endsWith("confirmed"))).toBe(true)
    // Ran again with the same events: what was handed out stands.
    expect(steps).toContain("predicted confirmed")
    // Ran again without them: withdrawn for good.
    expect(steps).toContain("predicted withdrawn")
  })

  it("keeps what it handed out when a rollback runs the tick again with the same events", () => {
    const match = setUpMatch({ mode: "rollback", latencyMS: 60, jitterMS: 40 })
    const [host] = match.peers
    const watcher = watch(host!)
    // Seat 1 only moves, so the host rolls back; the host's own shots do not depend on it.
    for (let at = 0; at < 400; at++) {
      frame(match, at, (seat) => seat === 0 ? pressed(0, at) : { ...pressed(1, at), fire: false })
      watcher.read()
    }
    expect(host!.session.status().rollbacks).toBeGreaterThan(50)
    const steps = [...watcher.history.values()].map((steps) => steps.join(" "))
    expect(steps.filter((line) => line === "predicted confirmed").length).toBeGreaterThan(20)
    expect(steps.filter((line) => line.includes("withdrawn"))).toEqual([])
  })

  it("withdraws every predicted tick on a resync", () => {
    const match = setUpMatch({ mode: "rollback", latencyMS: 100, jitterMS: 0, inputDelay: 0 })
    const [host] = match.peers
    const watchers = match.peers.map(watch)
    // Both seats hold fire: every tick has events, and every guess is right, so only the resync withdraws.
    const firing = (): PlayerInput => ({ dx: 0, fire: true })
    const resyncs = [0, 0]
    for (let at = 0; at < 300; at++) {
      if (at === 120) host!.session.resync()
      const epochs = match.peers.map((peer) => peer.session.status().epoch)
      const before = watchers.map((watcher) => new Set(watcher.outstanding))
      frame(match, at, firing)
      for (const [seat, peer] of match.peers.entries()) {
        const { withdrawn } = watchers[seat]!.read()
        if (epochs[seat] === 0 || peer.session.status().epoch === epochs[seat]) continue
        resyncs[seat]! += 1
        expect(before[seat]!.size).toBeGreaterThan(0)
        for (const tick of before[seat]!) expect(withdrawn).toContain(tick)
      }
    }
    expect(resyncs).toEqual([1, 1])
  })

  it("under lockstep, confirms every event once and predicts nothing", () => {
    const match = setUpMatch({ mode: "lockstep", latencyMS: 40, jitterMS: 20 })
    const watchers = match.peers.map(watch)
    for (let at = 0; at < 300; at++) {
      frame(match, at, (seat) => at < 240 ? pressed(seat, at) : idle)
      for (const watcher of watchers) expect(watcher.read()).toEqual({ predicted: [], withdrawn: [] })
    }
    for (const [seat, peer] of match.peers.entries()) {
      const { tick } = peer.session.status()
      expect(watchers[seat]!.confirmed).toEqual(reference(match.peers, tick).fired.filter((record) => record.tick < tick))
    }
  })

  it("gives each reader its own position, from the tick it was made", () => {
    const match = setUpMatch({ mode: "rollback", latencyMS: 30, jitterMS: 10 })
    const [host] = match.peers
    const early = host!.session.events(Fired)
    for (let at = 0; at < 100; at++) frame(match, at, (seat) => pressed(seat, at))
    const from = host!.session.status().tick
    const late = host!.session.events(Fired)
    const first = early.confirmed()
    for (let at = 100; at < 200; at++) frame(match, at, (seat) => pressed(seat, at))
    const rest = early.confirmed()
    const lateRecords = late.confirmed()
    expect(first.length).toBeGreaterThan(0)
    expect(lateRecords.length).toBeGreaterThan(0)
    expect(lateRecords.every((record) => record.tick >= from)).toBe(true)
    // The early reader's second read starts where its first ended; the late one sees the same records from its start.
    expect(rest.filter((record) => record.tick >= from)).toEqual(lateRecords)
    expect(rest[0]!.tick).toBeGreaterThan(first.at(-1)!.tick)
  })

  it("reports the confirmed events a reader did not read in time", () => {
    const match = setUpMatch({ mode: "lockstep", latencyMS: 0, jitterMS: 0, inputDelay: 0 })
    const [host] = match.peers
    const reader = host!.session.events(Fired)
    const frames = Netcode.eventWindow * 2
    for (let at = 0; at < frames; at++) frame(match, at, (seat) => ({ ...pressed(seat, at), fire: true }))
    const { tick } = host!.session.status()
    const lost = reader.lost()
    expect(lost?._tag).toBe("EventsLost")
    expect(lost!.from).toBeLessThan(10)
    expect(lost!.to).toBe(tick - Netcode.eventWindow)
    // Reported once.
    expect(reader.lost()).toBeUndefined()
    const kept = reader.confirmed()
    expect(kept[0]!.tick).toBe(lost!.to)
    expect(kept.at(-1)!.tick).toBe(tick - 1)
  })
})
