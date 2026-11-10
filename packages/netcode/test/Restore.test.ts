/**
 * Every peer restores seat 0's save, at the start and on `resync()`: a load
 * leaves nothing of the world it replaced, so what a peer held before (seat
 * 0's set-up world, a transient resource) never makes the peers disagree.
 */
import { describe, expect, it } from "vitest"
import { Clock, Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { InputCapture } from "@typeonce/ritmo-browser"
import { MemoryNetworkLink, Netcode } from "@typeonce/ritmo-netcode"

import { idle, PlayerInput, step } from "./game.ts"

type Check<T> = (raw: unknown) => { readonly value: T } | { readonly issues: ReadonlyArray<{ readonly message: string }> }
const schema = <T>(check: Check<T>): Descriptor.StandardSchema<T, T> => ({ "~standard": { version: 1, vendor: "test", validate: check } })
const Whole = schema<number>((raw) => Number.isSafeInteger(raw) ? { value: raw as number } : { issues: [{ message: "Expected an integer" }] })

const Root = Schema.defineRoot("NetRestore")
const Seats = Descriptor.Service<Netcode.Source<PlayerInput>>()("NetRestore/Seats")
const Inputs = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof Seats>>()("NetRestore/Inputs")
const Time = Clock.resource("NetRestore/Time", step)
const Crate = Descriptor.ConstructedComponent(Whole)("NetRestore/Crate")
const Broken = Descriptor.ConstructedResource(Whole)("NetRestore/Broken")
const Combo = Descriptor.ConstructedResource(Whole)("NetRestore/Combo")
const Streak = Descriptor.TransientResource<number>()("NetRestore/Streak")
const Game = Schema.bind(Schema.fragment({ components: { Crate }, resources: { Inputs, Time, Broken, Combo, Streak } }), Root)

// Counts despawned entities into a saved resource: a despawn record of the
// world a load replaced would count on one peer and not the other.
const CountBroken = Game.System("NetRestore/CountBroken", {
  despawned: { entities: Game.System.readDespawned() },
  resources: { broken: Game.System.writeResource(Broken) }
}, ({ despawned, resources }) => {
  const gone = despawned.entities.all().length
  if (gone > 0) resources.broken.update((broken) => broken + gone)
})
// Carries a count across ticks in a transient resource, which no save holds,
// and copies it into a saved one.
const CountStreak = Game.System("NetRestore/CountStreak", {
  resources: { streak: Game.System.writeResource(Streak), combo: Game.System.writeResource(Combo) }
}, ({ resources }) => {
  resources.streak.update((streak) => streak + 1)
  resources.combo.set(resources.streak.get())
})
const capture = InputCapture.system(Game, { name: "NetRestore/Capture", source: Seats, resource: Inputs })
const ticking = Clock.system(Game, { name: "NetRestore/Clock", resource: Time })
const readingDespawns = Game.Schedule(capture, ticking, CountBroken)
const carryingStreak = Game.Schedule(capture, ticking, CountStreak)

const SetUp = Game.System("NetRestore/SetUp", { commands: Game.System.commands(Game.System.spawns(Crate)) }, ({ commands }) => {
  for (let index = 0; index < 3; index++) commands.spawn(Game.Command.spawn([Crate, index]))
})

const makePeer = (host: boolean) => {
  const seats = Netcode.seats(PlayerInput, { count: 2, idle })
  if (!seats.ok) throw new Error(seats.error.reason)
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Seats, seats.value.source)),
    resources: { Inputs: [idle, idle], Time: Clock.start(step), Broken: 0, Combo: 0, Streak: 0 }
  })
  if (!made.ok) throw new Error("the runtime did not validate")
  // Only seat 0 sets its world up before the first save.
  if (host && !made.value.tick(Game.Schedule(SetUp, Game.Schedule.applyDeferred())).ok) throw new Error("set up failed")
  return { runtime: made.value, seats: seats.value }
}

/** Two peers over memory links on one test clock, every halt kept as `tag@tick`. */
const match = (simulate: "readingDespawns" | "carryingStreak") => {
  const hostClock = HostClock.test()
  const links = MemoryNetworkLink.make({ peers: 2, hostClock, seed: 3, latencyMS: 0, jitterMS: 0 })
  if (!links.ok) throw new Error(links.error.field)
  const peers = [0, 1].map((seat) => {
    const peer = makePeer(seat === 0)
    const options = { seats: peer.seats, seat, links: [links.value[seat]!], hostClock, step, checksumEvery: 10 }
    const session = simulate === "readingDespawns"
      ? Netcode.rollback(peer.runtime, { ...options, simulate: readingDespawns })
      : Netcode.rollback(peer.runtime, { ...options, simulate: carryingStreak })
    if (!session.ok) throw new Error(session.error.reason)
    const halts: Array<string> = []
    const update = session.value.update({ input: () => idle, onHalted: (error) => halts.push(`${error._tag}@${"tick" in error ? error.tick : "?"}`) })
    return { ...peer, session: session.value, halts, update }
  })
  /** One frame of every peer but `skip`. */
  const frame = (skip?: number) => {
    for (const [seat, peer] of peers.entries()) {
      if (seat === skip) continue
      const updated = peer.update()
      if (!updated.ok) throw new Error(JSON.stringify(updated.error))
    }
    hostClock.adjust(step.dt * 1000)
  }
  return { peers, frame }
}

describe("netcode restores", () => {
  it("a despawn reader agrees after the starting save, though only seat 0 had set its world up", () => {
    const { peers, frame } = match("readingDespawns")
    for (let at = 0; at < 300; at++) frame()
    expect(peers.flatMap((peer) => peer.halts)).toEqual([])
  })

  it("a count carried in a transient resource agrees after a resync", () => {
    const { peers, frame } = match("carryingStreak")
    for (let at = 0; at < 40; at++) frame()
    // Seat 0 hitches: seat 1 is two ticks ahead when seat 0 resyncs.
    frame(0)
    frame(0)
    peers[0]!.session.resync()
    for (let at = 0; at < 1200; at++) frame()
    expect(peers.flatMap((peer) => peer.halts)).toEqual([])
  })
})
