import { describe, expect, it } from "vitest"
import { Clock, Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { InputCapture } from "@typeonce/ritmo-browser"
import { MemoryNetworkLink, Netcode } from "@typeonce/ritmo-netcode"

import { idle, PlayerInput, step } from "./game.ts"
import { frame, setUpMatch } from "./match.ts"

type Check<T> = (raw: unknown) => { readonly value: T } | { readonly issues: ReadonlyArray<{ readonly message: string }> }
const schema = <T>(check: Check<T>): Descriptor.StandardSchema<T, T> => ({ "~standard": { version: 1, vendor: "test", validate: check } })
const Whole = schema<number>((raw) => Number.isSafeInteger(raw) ? { value: raw as number } : { issues: [{ message: "Expected an integer" }] })
/** A schema that normalizes: any dx is clamped to -1..1 (like a zod `.transform` or `.default`). */
const Clamped = schema<PlayerInput>((raw) => {
  const { dx, fire } = (raw ?? {}) as Record<string, unknown>
  return typeof dx === "number" && typeof fire === "boolean"
    ? { value: { dx: Math.max(-1, Math.min(1, Math.round(dx))), fire } }
    : { issues: [{ message: "Expected { dx, fire }" }] }
})

// A game of its own: the shared one fixes its codec.
const Seats = Descriptor.Service<Netcode.Source<PlayerInput>>()("NetSchema/Seats")
const Inputs = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof Seats>>()("NetSchema/Inputs")
const Time = Clock.resource("NetSchema/Time", step)
const Sum = Descriptor.ConstructedResource(Whole)("NetSchema/Sum")
const Root = Schema.defineRoot("NetSchema")
const Game = Schema.bind(Schema.fragment({ resources: { Inputs, Time, Sum } }), Root)
const Add = Game.System("NetSchema/Add", {
  resources: { inputs: Game.System.readResource(Inputs), sum: Game.System.writeResource(Sum) }
}, ({ resources }) => {
  for (const input of resources.inputs.get()) resources.sum.update((sum) => sum + input.dx)
})
const simulate = Game.Schedule(
  InputCapture.system(Game, { name: "NetSchema/Capture", source: Seats, resource: Inputs }),
  Clock.system(Game, { name: "NetSchema/Clock", resource: Time }),
  Add
)

const makePeer = (codec: Descriptor.StandardSchema<PlayerInput, PlayerInput>) => {
  const seats = Netcode.seats(codec, { count: 2, idle })
  if (!seats.ok) throw new Error(seats.error.reason)
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Seats, seats.value.source)),
    resources: { Inputs: [idle, idle], Time: Clock.start(step), Sum: 0 }
  })
  if (!made.ok) throw new Error("the starting resources did not validate")
  return { runtime: made.value, seats: seats.value }
}

const ReadSum = Game.Inspector("NetSchema/ReadSum", { resources: { sum: Game.System.readResource(Sum) } }, ({ resources }) => resources.sum.get())
const sumOf = (peer: ReturnType<typeof makePeer>): number => peer.runtime.inspect(ReadSum)

describe("the local input", () => {
  for (const mode of ["rollback", "lockstep"] as const) {
    it(`goes through the input schema, so a schema that normalizes gives every peer the same input (${mode})`, () => {
      const hostClock = HostClock.test()
      const links = MemoryNetworkLink.make({ peers: 2, hostClock, seed: 3, latencyMS: 0, jitterMS: 0 })
      if (!links.ok) throw new Error(links.error.field)
      let current: Array<PlayerInput> = [idle, idle]
      const peers = [0, 1].map((seat) => {
        const peer = makePeer(Clamped)
        const options = { simulate, seats: peer.seats, seat, links: [links.value[seat]!], hostClock, step, checksumEvery: 10 }
        const session = mode === "rollback" ? Netcode.rollback(peer.runtime, options) : Netcode.lockstep(peer.runtime, options)
        if (!session.ok) throw new Error(session.error.reason)
        const halts: Array<string> = []
        const update = session.value.update({ input: () => current[seat]!, onHalted: (error) => halts.push(`${error._tag}@${"tick" in error ? error.tick : "?"}`) })
        return { ...peer, halts, update, session: session.value }
      })
      for (let at = 0; at < 300; at++) {
        current = [idle, at === 20 ? { dx: 5, fire: false } : idle]
        for (const peer of peers) {
          const updated = peer.update()
          if (!updated.ok) throw new Error(JSON.stringify(updated.error))
        }
        hostClock.adjust(step.dt * 1000)
      }
      expect(peers.flatMap((peer) => peer.halts)).toEqual([])
      expect(peers[0]!.session.status().verified).toBeGreaterThan(200)
      // The schema clamped seat 1's 5 to 1 on both peers.
      expect(peers.map(sumOf)).toEqual([1, 1])
    })
  }

  it("throws when the input schema rejects it, instead of stalling the match", () => {
    const match = setUpMatch({ mode: "rollback", latencyMS: 20, jitterMS: 0 })
    let at = 0
    for (; at < 30; at++) frame(match, at, () => ({ dx: 1, fire: false }))
    // 0.5 is a number, so it compiles; the schema wants a whole dx.
    expect(() => frame(match, at++, (seat) => seat === 1 ? { dx: 0.5, fire: false } : idle)).toThrow(/does not decode with the input schema: Expected \{ dx, fire \}/)
  })

  it("goes through the input schema in a sync test too", () => {
    const peer = makePeer(Clamped)
    const test = Netcode.syncTest(peer.runtime, { simulate, seats: peer.seats, rewind: 4 })
    if (!test.ok) throw new Error(test.error.reason)
    const advanced = test.value.advance({ dx: 5, fire: false })
    expect(advanced.ok).toBe(true)
    // Seat 0's 5 clamped to 1, seat 1 idle.
    expect(sumOf(peer)).toBe(1)
    const rejecting = makePeer(PlayerInput)
    const strict = Netcode.syncTest(rejecting.runtime, { simulate, seats: rejecting.seats, rewind: 4 })
    if (!strict.ok) throw new Error(strict.error.reason)
    expect(() => strict.value.advance({ dx: 0.5, fire: false })).toThrow(/does not decode with the input schema/)
  })
})
