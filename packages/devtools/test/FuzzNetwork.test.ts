import { describe, expect, it } from "vitest"
import { Clock, Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { Fuzz, Invariant, Replay } from "@typeonce/ritmo-devtools"
import type { Netcode } from "@typeonce/ritmo-netcode"
import * as Codecs from "../../core/test/codecs.ts"

const step = Clock.hz(60)
type Pad = { readonly dx: number; readonly fire: boolean }
const Pad = Codecs.struct({ dx: Codecs.integer, fire: Codecs.boolean })
const idle: Pad = { dx: 0, fire: false }
const Seats = Descriptor.Service<Netcode.Source<Pad>>()("FuzzNet/Seats")
const Score = Descriptor.ConstructedResource(Codecs.integer)("FuzzNet/Score")
const Root = Schema.defineRoot("FuzzNet")
const Game = Schema.bind(Schema.fragment({ resources: { Score } }), Root)

/**
 * The planted nondeterminism: seat 1 moving right while firing adds a
 * counter kept in a module variable, which every peer in the process
 * shares, so the peers add different numbers and desync.
 */
let shared = 0
const play = (leaks: boolean) => Game.System(leaks ? "FuzzNet/Leaky" : "FuzzNet/Clean", {
  services: { seats: Game.System.consumeService(Seats) },
  resources: { score: Game.System.writeResource(Score) }
}, ({ services, resources }) => {
  for (const [seat, input] of services.seats.snapshot().entries()) {
    const bonus = leaks && seat === 1 && input.fire && input.dx === 1 ? (shared += 1) : 0
    resources.score.update((score) => (score * 3 + input.dx + (input.fire ? 7 : 0) + bonus) % 1_000_003)
  }
})

const hostClock = HostClock.test()
const makeGame = (leaks: boolean) => (playback: Replay.Playback) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Seats, playback.source(Seats))),
    resources: { Score: 0 },
    debug: { hostClock }
  })
  if (!made.ok) throw new Error("fixture")
  return { runtime: made.value, schedules: { setup: Game.Schedule(), update: Game.Schedule(play(leaks)) }, hostClock }
}

const Pads = Fuzz.seats(Seats, {
  codec: Pad,
  count: 2,
  generate: (random) => ({ dx: random.integer(-1, 2), fire: random.next() < 0.2 }),
  idle
})
const network = { seed: 5, latencyMS: 40, jitterMS: 30, loss: 0.15, step } as const

/** Every seat's input per replayed tick: a tick repeats the previous one's when it records none. */
const timelineOf = (file: Replay.ReplayFile): ReadonlyArray<ReadonlyArray<Pad>> => {
  let current: ReadonlyArray<Pad> = [idle, idle]
  return file.ticks.map((record) => current = (record.services?.[Seats.name]?.[0] as ReadonlyArray<Pad> | undefined) ?? current)
}

describe("Fuzz.run over a network", () => {
  it("finds the desync between two peers over a lossy link, and shrinks it to one press of seat 1", () => {
    const found = Fuzz.run(makeGame(true), { schedule: "update", setup: "setup", inputs: [Pads], frames: 120, seed: 1, network })
    if (found.ok || found.error._tag !== "Found") throw new Error(JSON.stringify(found))
    const { violation, replay, shrink } = found.error
    expect(violation._tag).toBe("SessionFailed")
    if (violation._tag !== "SessionFailed" || violation.error._tag !== "Desynced") throw new Error(JSON.stringify(violation))
    // The sessions keep their saves: the score is what went apart.
    expect(violation.error.snapshot?.resources).toHaveProperty(Score.name)
    // Fewer frames of input; the desync shows on a later frame, once the checksums met.
    expect(shrink.toFrames).toBeLessThan(shrink.fromFrames)
    expect(replay.ticks.length).toBe(shrink.toFrames)
    expect(found.error.frame).toBeGreaterThan(shrink.toFrames)
    // Every press but one is gone: seat 1 moving right while firing, seat 0 idle.
    const pressed = timelineOf(replay).flatMap((seats, tick) => seats.flatMap((input, seat) => input.dx === 0 && !input.fire ? [] : [{ tick, seat, input }]))
    expect(pressed.map(({ seat, input }) => ({ seat, input }))).toEqual([{ seat: 1, input: { dx: 1, fire: true } }])
    expect(replay.reason).toContain(`over network seed ${network.seed}: seat `)
    expect(replay.reason).toContain("session failed with Desynced at tick")
    // One runtime plays the timeline without the network: nothing to desync.
    expect(found.error.reproduces).toBe(false)
  })

  it("is deterministic with the network seed fixed", () => {
    const options = { schedule: "update", inputs: [Pads], frames: 120, seed: 1, network, shrinkAttempts: 40 } as const
    // The planted counter starts over too, so both runs see the same bug.
    const fuzz = () => {
      shared = 0
      return JSON.stringify(Fuzz.run(makeGame(true), options))
    }
    expect(fuzz()).toBe(fuzz())
  })

  it("passes a deterministic game over the same faulty network, checking invariants on every peer", () => {
    let checked = 0
    const Bounded = Invariant.fromInspector(Game.Inspector("score in range", { resources: { score: Game.System.readResource(Score) } }, ({ resources }) => {
      checked += 1
      return resources.score.get() < 1_000_003 ? undefined : "score overflow"
    }))
    const passed = Fuzz.run(makeGame(false), { schedule: "update", inputs: [Pads], invariants: [Bounded], frames: 120, runs: 2, seed: 1, network })
    expect(passed).toMatchObject({ ok: true, value: { data: { runs: 2, frames: 120, seed: 1 } } })
    // Two runs, two peers, every fuzzed and settling frame.
    expect(checked).toBe(2 * 2 * (120 + 120))
  })

  it("rejects a factory that reads input besides the seats", () => {
    const Extra = Descriptor.Service<{ readonly snapshot: () => number }>()("FuzzNet/Extra")
    const extra = (playback: Replay.Playback) => {
      playback.source(Extra)
      return makeGame(false)(playback)
    }
    const rejected = Fuzz.run(extra, { schedule: "update", inputs: [Pads], frames: 10, seed: 1, network })
    expect(rejected.ok ? undefined : rejected.error).toMatchObject({ _tag: "InvalidOptions", message: expect.stringContaining("FuzzNet/Extra") })
  })

  describe("with seats that leave", () => {
    const gone: Pad = { dx: 9, fire: false }
    /**
     * Four seats, and a game that handles a seat without a driver: it
     * counts the ticks each such seat sat out. `leaks` plants the bug: on
     * those ticks it also adds the counter every peer in the process shares.
     */
    const Out = Descriptor.ConstructedResource(Codecs.integer)("FuzzNet/Out")
    const Table = Schema.bind(Schema.fragment({ resources: { Score, Out } }), Schema.defineRoot("FuzzNetLeave"))
    const sit = (leaks: boolean) => Table.System(leaks ? "FuzzNet/SitLeaky" : "FuzzNet/Sit", {
      services: { seats: Table.System.consumeService(Seats) },
      resources: { score: Table.System.writeResource(Score), out: Table.System.writeResource(Out) }
    }, ({ services, resources }) => {
      for (const input of services.seats.snapshot()) {
        if (input.dx === gone.dx) {
          resources.out.update((ticks) => ticks + 1)
          if (leaks) resources.score.update((score) => (score + (shared += 1)) % 1_000_003)
        } else resources.score.update((score) => (score * 3 + input.dx + (input.fire ? 7 : 0)) % 1_000_003)
      }
    })
    const makeTable = (leaks: boolean) => (playback: Replay.Playback) => {
      const made = Table.Runtime.make({
        services: Table.Runtime.services(Table.Runtime.service(Seats, playback.source(Seats))),
        resources: { Score: 0, Out: 0 },
        debug: { hostClock }
      })
      if (!made.ok) throw new Error("fixture")
      return { runtime: made.value, schedules: { update: Table.Schedule(sit(leaks)) }, hostClock }
    }
    const Four = Fuzz.seats(Seats, { codec: Pad, count: 4, generate: (random) => ({ dx: random.integer(-1, 2), fire: random.next() < 0.2 }), idle, left: gone })
    const leaving = { ...network, leave: { seats: 2 } } as const

    it("plays every run on without them, and checks the invariants on the peers still there", () => {
      let sat = 0
      let checked = 0
      const Counted = Invariant.fromInspector(Table.Inspector("seats out", { resources: { out: Table.System.readResource(Out) } }, ({ resources }) => {
        checked += 1
        sat = Math.max(sat, resources.out.get())
        return undefined
      }))
      const passed = Fuzz.run(makeTable(false), { schedule: "update", inputs: [Four], invariants: [Counted], frames: 240, runs: 4, seed: 3, network: leaving })
      expect(passed).toMatchObject({ ok: true, value: { data: { runs: 4, frames: 240, seed: 3 } } })
      // The simulation read the `left` input for the seats that left, on every peer still there.
      expect(sat).toBeGreaterThan(100)
      // Fewer checks than four peers on every frame: a page that is gone is not checked.
      expect(checked).toBeLessThan(4 * 4 * (240 + 120))
      expect(checked).toBeGreaterThanOrEqual(4 * 2 * (240 + 120))
    })

    it("finds what the game does wrong with a seat that left, and names the seats and frames", { timeout: 30_000 }, () => {
      shared = 0
      const found = Fuzz.run(makeTable(true), { schedule: "update", inputs: [Four], frames: 240, seed: 3, network: leaving, shrinkAttempts: 20 })
      if (found.ok || found.error._tag !== "Found") throw new Error(JSON.stringify(found))
      expect(found.error.violation).toMatchObject({ _tag: "SessionFailed", error: { _tag: "Desynced" } })
      expect(found.error.left.length).toBeGreaterThan(0)
      for (const { seat, frame } of found.error.left) {
        expect(seat).toBeLessThan(4)
        expect(frame).toBeLessThan(240)
      }
      // The replay holds the `left` input for a seat from the frame it left on.
      const [first] = found.error.left
      const seated = found.error.replay.ticks.map((record) => (record.services?.[Seats.name]?.[0] as ReadonlyArray<Pad> | undefined)?.[first!.seat])
      expect(seated.filter((input) => input?.dx === gone.dx).length).toBeGreaterThan(0)
      // The same game without the leaves never reads `left`: nothing to find.
      shared = 0
      expect(Fuzz.run(makeTable(true), { schedule: "update", inputs: [Four], frames: 240, seed: 3, network }).ok).toBe(true)
    })

    it("rejects more leaving seats than leave two to play on", () => {
      const rejected = Fuzz.run(makeTable(false), { schedule: "update", inputs: [Four], frames: 10, seed: 1, network: { ...network, leave: { seats: 3 } } })
      expect(rejected.ok ? undefined : rejected.error).toMatchObject({ _tag: "InvalidOptions", message: expect.stringContaining("from 1 to 2") })
      const none = Fuzz.run(makeGame(false), { schedule: "update", inputs: [Pads], frames: 10, seed: 1, network: { ...network, leave: { seats: 1 } } })
      expect(none.ok ? undefined : none.error).toMatchObject({ _tag: "InvalidOptions", message: expect.stringContaining("from 1 to 0") })
    })
  })

  it("leaves the single-peer fuzzer reading every seat from one runtime", () => {
    const passed = Fuzz.run(makeGame(false), { schedule: "update", inputs: [Pads], frames: 30, runs: 1, seed: 1 })
    expect(passed.ok).toBe(true)
  })
})
