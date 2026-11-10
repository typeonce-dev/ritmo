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
    expect(lost!.reason).toBe("unread")
    expect(lost!.from).toBeLessThan(10)
    expect(lost!.to).toBe(tick - Netcode.eventWindow)
    // Reported once.
    expect(reader.lost()).toBeUndefined()
    const kept = reader.confirmed()
    expect(kept[0]!.tick).toBe(lost!.to)
    expect(kept.at(-1)!.tick).toBe(tick - 1)
  })

  describe("a resync that replaces ticks a peer ahead of seat 0 confirmed", () => {
    /**
     * Seat 1 runs a tick or two ahead of seat 0 and confirms ticks seat 0
     * has not run yet. Seat 0 hitches for two frames and resyncs: its save
     * makes those ticks idle for every seat, so seat 1 runs them again.
     */
    const resyncAhead = (input: (seat: number, at: number) => PlayerInput, options: { readonly tail?: number; readonly read?: boolean } = {}) => {
      const match = setUpMatch({ mode: "rollback", latencyMS: 0, jitterMS: 0, inputDelay: 2 })
      const [host, other] = match.peers as [MatchPeer, MatchPeer]
      const hostReader = host.session.events(Fired)
      const otherReader = other.session.events(Fired)
      const hostConfirmed: Array<string> = []
      const otherConfirmed: Array<string> = []
      const lost: Array<Netcode.EventsLost> = []
      const read = () => {
        for (const record of hostReader.confirmed()) hostConfirmed.push(`${record.tick}:${record.value.seat}`)
        // A reader that stops reading: seat 1's waits until the test reads it.
        if (options.read === false) return
        for (const record of otherReader.confirmed()) otherConfirmed.push(`${record.tick}:${record.value.seat}`)
        const reported = otherReader.lost()
        if (reported !== undefined) lost.push(reported)
      }
      let at = 0
      for (; at < 40; at++) {
        frame(match, at, (seat) => input(seat, at))
        read()
      }
      // Seat 0 hitches: seat 1 runs on and confirms ticks seat 0 has not run.
      for (let n = 0; n < 2; n++, at++) {
        frame(match, at, (seat) => input(seat, at), (seat) => seat === 0)
        read()
      }
      const resyncAt = host.session.status().tick
      const confirmedAhead = other.session.status().confirmed
      host.session.resync()
      for (let n = 0; n < (options.tail ?? 60); n++, at++) {
        frame(match, at, () => idle)
        read()
      }
      return { hostConfirmed, otherConfirmed, lost, resyncAt, confirmedAhead, otherReader }
    }

    it("reports through lost() the confirmed events it replaced", () => {
      const { hostConfirmed, otherConfirmed, lost, resyncAt, confirmedAhead } = resyncAhead(() => ({ dx: 1, fire: true }))
      expect(confirmedAhead).toBeGreaterThan(resyncAt)
      // Handed out before the resync, so they stay handed out; the save ran those ticks idle, with no events.
      const replaced = otherConfirmed.filter((record) => !hostConfirmed.includes(record))
      expect(replaced).toEqual([`${resyncAt}:0`, `${resyncAt}:1`, `${resyncAt + 1}:0`, `${resyncAt + 1}:1`])
      expect(lost).toEqual([{ _tag: "EventsLost", from: resyncAt, to: resyncAt + 2, reason: "resync" }])
    })

    it("reports nothing when the ticks it ran again published the same events", () => {
      // Both seats stop firing before the hitch: the confirmed ticks and their idle runs publish nothing.
      const { hostConfirmed, otherConfirmed, lost, resyncAt, confirmedAhead } = resyncAhead((_, at) => ({ dx: 1, fire: at < 30 }))
      expect(confirmedAhead).toBeGreaterThan(resyncAt)
      expect(otherConfirmed.length).toBeGreaterThan(0)
      expect(otherConfirmed).toEqual(hostConfirmed)
      expect(lost).toEqual([])
    })

    it("reports a resync first, and what the reader did not read in time on the next call", () => {
      const { otherReader, resyncAt } = resyncAhead(() => ({ dx: 1, fire: true }), { tail: Netcode.eventWindow + 60, read: false })
      expect(otherReader.lost()).toEqual({ _tag: "EventsLost", from: resyncAt, to: resyncAt + 2, reason: "resync" })
      expect(otherReader.lost()).toMatchObject({ _tag: "EventsLost", from: 2, reason: "unread" })
      expect(otherReader.lost()).toBeUndefined()
    })
  })
})
