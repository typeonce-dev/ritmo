/**
 * The network half of `Fuzz.run`: one simulation of every seat as its own
 * peer, each a fresh runtime from the game's factory, joined by a seeded
 * `MemoryNetworkLink` on one test clock and driven by `Netcode.rollback`
 * sessions. Deterministic for a timeline and a network seed, so shrinking
 * can run it again.
 */
import { HostClock } from "@typeonce/ritmo"
import type * as Clock from "@typeonce/ritmo/Clock"
import type * as Descriptor from "@typeonce/ritmo/Descriptor"
import type { Source } from "@typeonce/ritmo/Schedule"
import { MemoryNetworkLink, Netcode } from "@typeonce/ritmo-netcode"

import type { Invariant } from "../Invariant.ts"
import type * as Replay from "../Replay.ts"

/** What one networked simulation came to: as `Fuzz`'s single-runtime outcome, without a replay. */
export type NetworkOutcome<Violation> =
  | { readonly kind: "passed" }
  | { readonly kind: "violated"; readonly violation: Violation; readonly frame: number }
  | { readonly kind: "invalid"; readonly message: string }

export interface NetworkPlan {
  /** The seats' service, codec, count, and idle input. */
  readonly name: string
  readonly codec: Descriptor.Codec<any, any>
  readonly count: number
  readonly idle: unknown
  /** The game's factory, and the schedules it is fuzzed with. */
  readonly make: (playback: Replay.Playback) => { readonly runtime: unknown; readonly schedules: Readonly<Record<string, unknown>> }
  readonly schedule: string
  readonly setup: string | undefined
  readonly invariants: ReadonlyArray<Invariant>
  readonly step: Clock.Step
  readonly seed: number
  readonly latencyMS: number
  readonly jitterMS: number
  readonly loss: number
  readonly settle: number
  readonly inputDelay: number | undefined
  readonly maxRollback: number | undefined
  readonly checksumEvery: number | undefined
}

/** What the sessions call on a runtime the factory made. `Fuzz.run`'s signature checked the real types. */
interface Peer {
  readonly tryTick: (schedule: unknown) => { readonly ok: boolean; readonly error?: unknown }
  readonly inspect: (inspector: unknown) => unknown
}

export type NetworkViolation =
  | { readonly _tag: "SessionFailed"; readonly seat: number; readonly error: Netcode.SessionError<unknown> }
  | { readonly _tag: "InvariantViolated"; readonly invariant: string; readonly message: string }
  | { readonly _tag: "Defect"; readonly invariant: string | undefined; readonly error: unknown }

/** Plays `timeline` (per frame, the seats input's value: every seat's local input) on one peer per seat, then `settle` idle frames. */
export const play = (plan: NetworkPlan, timeline: ReadonlyArray<ReadonlyArray<unknown>>): NetworkOutcome<NetworkViolation> => {
  const hostClock = HostClock.test()
  const links = MemoryNetworkLink.make({ peers: plan.count, hostClock, seed: plan.seed, latencyMS: plan.latencyMS, jitterMS: plan.jitterMS, loss: plan.loss })
  if (!links.ok) return { kind: "invalid", message: `network.${links.error.field} is out of range: ${links.error.value}` }
  const peers: Array<{ readonly runtime: Peer; readonly session: Netcode.Session<unknown, unknown> }> = []
  for (let seat = 0; seat < plan.count; seat++) {
    const seats = Netcode.seats(plan.codec, { count: plan.count, idle: plan.idle })
    if (!seats.ok) return { kind: "invalid", message: `the seats' idle input: ${seats.error.reason}` }
    const unknown: Array<string> = []
    const playback: Replay.Playback = {
      source: <const SourceName extends string, Data>(descriptor: Descriptor.Descriptor<"service", SourceName, Source<Data>>): Source<Data> => {
        if (descriptor.name !== plan.name) unknown.push(descriptor.name)
        // `Fuzz.seats` checked that this service is a `Netcode.Source` of the seats' input.
        return seats.value.source as unknown as Source<Data>
      },
      constant: () => undefined
    }
    const target = plan.make(playback)
    if (unknown.length > 0) return { kind: "invalid", message: `make asked playback.source for ${unknown.join(", ")}: over a network the simulation reads its input from the seats alone` }
    const runtime = target.runtime as Peer
    const schedule = target.schedules[plan.schedule]
    if (schedule === undefined) return { kind: "invalid", message: `make returned no schedule ${plan.schedule}` }
    // Only seat 0 sets up: every peer starts from its save.
    if (seat === 0 && plan.setup !== undefined) {
      const setup = target.schedules[plan.setup]
      if (setup === undefined) return { kind: "invalid", message: `make returned no schedule ${plan.setup}` }
      const ticked = runtime.tryTick(setup)
      if (!ticked.ok) return { kind: "invalid", message: `setup failed with every input neutral: ${JSON.stringify(ticked.error)}` }
    }
    // `Fuzz.run`'s signature checked that the schedule rewinds and the runtime saves, as `Netcode.rollback` does.
    const session = (Netcode.rollback as unknown as (runtime: unknown, options: unknown) => ReturnType<typeof Netcode.rollback>)(runtime, {
      simulate: schedule,
      seats: seats.value,
      seat,
      links: [links.value[seat]!],
      hostClock,
      step: plan.step,
      keepSnapshots: true,
      ...(plan.inputDelay === undefined ? {} : { inputDelay: plan.inputDelay }),
      ...(plan.maxRollback === undefined ? {} : { maxRollback: plan.maxRollback }),
      ...(plan.checksumEvery === undefined ? {} : { checksumEvery: plan.checksumEvery })
    })
    if (!session.ok) return { kind: "invalid", message: `network.${session.error.field}: ${session.error.reason}` }
    peers.push({ runtime, session: session.value as Netcode.Session<unknown, unknown> })
  }

  const stepMS = plan.step.dt * 1000
  const frames = timeline.length + plan.settle
  for (let frame = 0; frame < frames; frame++) {
    const values = timeline[frame]?.[0] as ReadonlyArray<unknown> | undefined
    for (const [seat, { session }] of peers.entries()) {
      let advanced: ReturnType<typeof session.advance>
      try {
        advanced = session.advance(values === undefined ? plan.idle : values[seat])
      } catch (error) {
        return { kind: "violated", violation: { _tag: "Defect", invariant: undefined, error }, frame: frame + 1 }
      }
      if (!advanced.ok) return { kind: "violated", violation: { _tag: "SessionFailed", seat, error: advanced.error }, frame: frame + 1 }
    }
    for (const { runtime } of peers) {
      for (const invariant of plan.invariants) {
        let message: unknown
        try {
          message = runtime.inspect(invariant.inspector)
        } catch (error) {
          return { kind: "violated", violation: { _tag: "Defect", invariant: invariant.name, error }, frame: frame + 1 }
        }
        if (typeof message === "string") return { kind: "violated", violation: { _tag: "InvariantViolated", invariant: invariant.name, message }, frame: frame + 1 }
      }
    }
    hostClock.adjust(stepMS)
  }
  return { kind: "passed" }
}
