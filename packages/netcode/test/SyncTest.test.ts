import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import { InputCapture } from "@typeonce/ritmo-browser"
import { Desync } from "@typeonce/ritmo-devtools"
import { Netcode } from "@typeonce/ritmo-netcode"

import { idle, makePeer, pressed, PlayerInput, simulate, type PlayerInput as Input } from "./game.ts"

const valueOf = <A>(result: { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: unknown }): A => {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

type Check<T> = (raw: unknown) => { readonly value: T } | { readonly issues: ReadonlyArray<{ readonly message: string }> }
const schema = <T>(check: Check<T>): Descriptor.StandardSchema<T, T> => ({ "~standard": { version: 1, vendor: "test", validate: check } })
const Whole = schema<number>((raw) => Number.isSafeInteger(raw) ? { value: raw as number } : { issues: [{ message: "Expected an integer" }] })

/**
 * The planted bug: a combo counter kept in a module variable, not in the
 * world. Every fire adds the combo so far to the score, so a rewind that
 * runs a fire again counts it twice.
 */
let combo = 0
const Score = Descriptor.ConstructedResource(Whole)("SyncTest/Score")
const Shots = Descriptor.ConstructedResource(Whole)("SyncTest/Shots")
const Seats = Descriptor.Service<Netcode.Source<Input>>()("SyncTest/Seats")
const Inputs = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof Seats>>()("SyncTest/Inputs")
const Leaky = Schema.bind(Schema.fragment({ resources: { Score, Shots, Inputs } }))
const Capture = InputCapture.system(Leaky, { name: "SyncTest/Capture", source: Seats, resource: Inputs })
const Fire = Leaky.System("SyncTest/Fire", {
  resources: { inputs: Leaky.System.readResource(Inputs), score: Leaky.System.writeResource(Score), shots: Leaky.System.writeResource(Shots) }
}, ({ resources }) => {
  if (!resources.inputs.get()[0]!.fire) return
  combo += 1
  resources.score.update((score) => score + combo)
  resources.shots.update((shots) => shots + 1)
})
const leaky = Leaky.Schedule(Capture, Fire)

const makeLeaky = () => {
  combo = 0
  const seats = valueOf(Netcode.seats(PlayerInput, { count: 2, idle }))
  const runtime = valueOf(Leaky.Runtime.make({
    services: Leaky.Runtime.services(Leaky.Runtime.service(Seats, seats.source)),
    resources: { Score: 0, Shots: 0, Inputs: [idle, idle] }
  }))
  return { runtime, seats }
}

describe("Netcode.syncTest", () => {
  it("passes a game that rewinds exactly, rolling back after every tick", () => {
    const peer = makePeer()
    const test = valueOf(Netcode.syncTest(peer.runtime, { simulate, seats: peer.seats, rewind: 6 }))
    for (let frame = 0; frame < 200; frame++) {
      const advanced = valueOf(test.advance(pressed(0, frame)))
      expect(advanced.tick).toBe(frame + 1)
      expect(advanced.again).toBe(Math.min(frame + 1, 6))
    }
    expect(test.status()).toEqual({ tick: 200, verified: 200, rollbacks: 200, again: 15 + 195 * 6 })
  })

  it("gives every other seat its predicted input", () => {
    const peer = makePeer()
    const moving = (previous: Input): Input => ({ dx: previous.dx === 1 ? -1 : 1, fire: !previous.fire })
    const test = valueOf(Netcode.syncTest(peer.runtime, { simulate, seats: peer.seats, rewind: 3, predict: moving }))
    for (let frame = 0; frame < 60; frame++) valueOf(test.advance(idle))
    expect(peer.seats.source.snapshot()[0]).toEqual(idle)
    expect(peer.seats.source.snapshot()[1]).not.toEqual(idle)
  })

  it("fails with RewindDiffers on the tick after the first fire a rewind runs again", () => {
    const { runtime, seats } = makeLeaky()
    const test = valueOf(Netcode.syncTest(runtime, { simulate: leaky, seats, rewind: 4, keepSnapshots: true }))
    let failure: Netcode.SyncTestError<unknown> | undefined
    let frame = 0
    for (; frame < 30 && failure === undefined; frame++) {
      const advanced = test.advance({ dx: 0, fire: frame === 10 })
      if (!advanced.ok) failure = advanced.error
    }
    // Tick 10 fires; its forced rollback runs it again, so the world at the start of tick 11 differs.
    expect(frame).toBe(11)
    expect(failure?._tag).toBe("RewindDiffers")
    if (failure?._tag !== "RewindDiffers") return
    expect(failure.tick).toBe(11)
    expect(failure.expected).not.toBe(failure.actual)
    const differences = Desync.compare(failure.snapshots!.expected, failure.snapshots!.actual).data
    expect(differences.map((difference) => difference.path)).toEqual(["resource SyncTest/Score"])
    expect(differences[0]).toMatchObject({ mine: 1, theirs: 2 })
    // The session stays stopped with the same error.
    expect(test.advance(idle)).toEqual({ ok: false, error: failure })
    expect(test.status()).toMatchObject({ tick: 11, verified: 10, rollbacks: 11 })
  })

  it("carries no saves unless asked", () => {
    const { runtime, seats } = makeLeaky()
    const test = valueOf(Netcode.syncTest(runtime, { simulate: leaky, seats, rewind: 1 }))
    const advanced = test.advance({ dx: 0, fire: true })
    expect(advanced.ok ? undefined : advanced.error).toMatchObject({ _tag: "RewindDiffers", tick: 1, snapshots: undefined })
  })

  it("rejects a rewind deeper than the checkpoints the runtime keeps, and seats another session took", () => {
    const small = makePeer({ checkpoints: 4 })
    const deep = Netcode.syncTest(small.runtime, { simulate, seats: small.seats, rewind: 5 })
    expect(deep.ok ? undefined : deep.error).toMatchObject({ _tag: "InvalidOptions", field: "rewind" })
    expect(Netcode.syncTest(small.runtime, { simulate, seats: small.seats, rewind: 0 }).ok).toBe(false)
    expect(Netcode.syncTest(small.runtime, { simulate, seats: small.seats, rewind: 4 }).ok).toBe(true)
    const taken = Netcode.syncTest(small.runtime, { simulate, seats: small.seats, rewind: 4 })
    expect(taken.ok ? undefined : taken.error).toMatchObject({ _tag: "InvalidOptions", field: "seats" })
  })
})
