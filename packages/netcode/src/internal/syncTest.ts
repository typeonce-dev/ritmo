/**
 * The engine behind `Netcode.syncTest`.
 *
 * One peer, no links. Each `advance` runs the next tick with seat 0's input
 * and every other seat's predicted one, keeping the checksum of the world at
 * the start of every tick and a checkpoint. Then it rewinds `rewind` ticks
 * (fewer at the start of the match), runs them again with the same inputs,
 * and compares the checksum at the start of every tick it runs again, and at
 * the present, with the first run's. A rewind is exact, so a difference is
 * state the rewind did not put back: the simulation read something outside
 * the world.
 */
import type * as Checkpoint from "@typeonce/ritmo/Checkpoint"
import * as Result from "@typeonce/ritmo/Result"
import type * as Snapshot from "@typeonce/ritmo/Snapshot"

import type { Advanced, InvalidOptions, RewindDiffers, Seats, SyncTest, SyncTestError, SyncTestStatus } from "../Netcode.ts"
import { stateOf } from "./seats.ts"
import type { Driven } from "./session.ts"

export interface SyncTestMakeOptions {
  readonly simulate: unknown
  readonly seats: Seats<unknown>
  readonly rewind: number
  readonly predict?: (previous: unknown) => unknown
  readonly keepSnapshots?: boolean
}

const invalid = (field: string, value: unknown, reason: string): Result.Failure<InvalidOptions> =>
  Result.failure({ _tag: "InvalidOptions", field, value, reason })

interface Sum {
  readonly sum: string
  readonly snapshot: Snapshot.WorldSnapshot | undefined
}

export const make = (runtime: Driven, options: SyncTestMakeOptions): Result.Result<SyncTest<unknown, unknown>, InvalidOptions> => {
  const seatsState = stateOf(options.seats)
  if (seatsState === undefined) return invalid("seats", options.seats, "make seats with Netcode.seats")
  if (seatsState.owner !== undefined) return invalid("seats", options.seats, "these seats already belong to a session: make one Netcode.seats for each runtime")
  if (!Object.values(runtime.services).includes(options.seats.source)) {
    return invalid("seats", options.seats, "the runtime does not provide seats.source: give it to Game.Runtime.service(...) for the service the simulation captures")
  }
  const depth = options.rewind
  if (!Number.isSafeInteger(depth) || depth < 1) return invalid("rewind", depth, "a whole number of ticks, 1 or more")
  // The runtime must hold `rewind` checkpoints: take that many and go back to the first.
  const probe: Array<Checkpoint.Checkpoint> = []
  for (let index = 0; index < depth; index++) probe.push(runtime.checkpoint(options.simulate))
  if (!runtime.rewind(probe[0]!).ok) {
    return invalid("rewind", depth, "the runtime keeps fewer checkpoints than rewind: give Game.Runtime.make a checkpoints option of at least rewind")
  }
  seatsState.owner = {}

  const count = options.seats.count
  const predict = options.predict ?? ((previous: unknown) => previous)
  const keep = options.keepSnapshots === true
  let last: ReadonlyArray<unknown> = Array.from({ length: count }, () => options.seats.idle)
  let next = 0
  let verified = -1
  let rollbacks = 0
  let again = 0
  let failed: SyncTestError<unknown> | undefined
  const inputs = new Map<number, ReadonlyArray<unknown>>()
  const sums = new Map<number, Sum>()
  const history = new Map<number, Checkpoint.Checkpoint>()

  /** The checksum (and save, when kept) of the world now. */
  const measure = (): Sum | undefined => {
    const sum = runtime.checksum()
    if (!sum.ok) {
      failed = { _tag: "SyncFailed", error: sum.error }
      return undefined
    }
    const snapshot = keep ? runtime.snapshot() : undefined
    return { sum: sum.value, snapshot: snapshot?.ok === true ? snapshot.value : undefined }
  }

  /** Whether the world at the start of `tick` is the one the first run had there. */
  const agrees = (tick: number): boolean => {
    const first = sums.get(tick)
    if (first === undefined) return true
    const now = measure()
    if (now === undefined) return false
    if (now.sum === first.sum) return true
    const differs: RewindDiffers = {
      _tag: "RewindDiffers",
      tick,
      expected: first.sum,
      actual: now.sum,
      snapshots: first.snapshot !== undefined && now.snapshot !== undefined ? { expected: first.snapshot, actual: now.snapshot } : undefined
    }
    failed = differs
    return false
  }

  /** Ticks `tick` with its recorded inputs, after its checkpoint. */
  const runTick = (tick: number): boolean => {
    history.set(tick, runtime.checkpoint(options.simulate))
    seatsState.current = inputs.get(tick)!
    const ticked = runtime.tick(options.simulate)
    if (ticked.ok) return true
    failed = { _tag: "TickFailed", tick, error: ticked.error }
    return false
  }

  const advance = (local: unknown): Result.Result<Extract<Advanced, { readonly _tag: "Ran" }>, SyncTestError<unknown>> => {
    if (failed !== undefined) return Result.failure(failed)
    const tick = next
    const current = last.map((previous, seat) => seat === 0 ? local : predict(previous))
    last = current
    inputs.set(tick, current)
    if (!sums.has(tick)) {
      const start = measure()
      if (start === undefined) return Result.failure(failed!)
      sums.set(tick, start)
    }
    if (!runTick(tick)) return Result.failure(failed!)
    next = tick + 1
    const end = measure()
    if (end === undefined) return Result.failure(failed!)
    sums.set(next, end)

    // The forced rollback: back to `rewind` ticks ago, and every tick up to the present again.
    const from = Math.max(0, next - depth)
    const checkpoint = history.get(from)
    const rewound = checkpoint === undefined
      ? Result.failure<Checkpoint.RewindError>({ _tag: "Released", reason: "window" })
      : runtime.rewind(checkpoint)
    if (!rewound.ok) {
      failed = { _tag: "CheckpointLost", error: rewound.error }
      return Result.failure(failed)
    }
    rollbacks += 1
    for (let at = from; at < next; at++) {
      if (!agrees(at) || !runTick(at)) return Result.failure(failed!)
      again += 1
    }
    if (!agrees(next)) return Result.failure(failed!)
    verified = next

    for (const at of inputs.keys()) if (at < next - depth) inputs.delete(at)
    for (const at of sums.keys()) if (at < next - depth) sums.delete(at)
    for (const at of history.keys()) if (at < next - depth) history.delete(at)
    return Result.success({ _tag: "Ran", tick: next, ticks: 1 + next - from, again: next - from, input: tick })
  }

  return Result.success({
    advance,
    status: (): SyncTestStatus => ({ tick: next, verified, again, rollbacks })
  })
}
