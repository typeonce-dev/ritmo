/**
 * A rollback session over a game whose simulation steps a library that keeps
 * its own world (a stand-in for a physics engine), provided as a
 * `Checkpoint.rewindable` service: the session compiles, and every rollback
 * puts the library's world back with the ECS world.
 */
import { describe, expect, it } from "vitest"
import { Checkpoint, Clock, Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import { InputCapture } from "@typeonce/ritmo-browser"
import { MemoryNetworkLink, Netcode } from "@typeonce/ritmo-netcode"

import { idle, PlayerInput, pressed, step } from "./game.ts"

type Check<T> = (raw: unknown) => { readonly value: T } | { readonly issues: ReadonlyArray<{ readonly message: string }> }
const schema = <T>(check: Check<T>): Descriptor.StandardSchema<T, T> => ({ "~standard": { version: 1, vendor: "test", validate: check } })
const Whole = schema<number>((raw) => Number.isSafeInteger(raw) ? { value: raw as number } : { issues: [{ message: "Expected an integer" }] })

/** Steps in place and remembers every step, like a physics world that keeps its own state. */
class World {
  constructor(public x: number, public readonly history: Array<number>) {}
  step(dx: number): void {
    this.x += dx
    this.history.push(this.x)
  }
}

const makeWorld = () => {
  const counts = { restores: 0 }
  const world = Checkpoint.rewindable(new World(0, []), {
    save: (world) => ({ x: world.x, history: world.history.slice() }),
    restore: (saved) => {
      counts.restores++
      return Result.success(new World(saved.x, saved.history.slice()))
    }
  })
  return { world, counts }
}

const Physics = Descriptor.Service<ReturnType<typeof makeWorld>["world"]>()("NetRewind/Physics")
const Seats = Descriptor.Service<Netcode.Source<PlayerInput>>()("NetRewind/Seats")
const Inputs = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof Seats>>()("NetRewind/Inputs")
const Time = Clock.resource("NetRewind/Time", step)
/** What gameplay reads from the library's world, mirrored so the checksum covers it. */
const Position = Descriptor.ConstructedResource(Whole)("NetRewind/Position")
const Game = Schema.bind(Schema.fragment({ resources: { Inputs, Time, Position } }))

const Move = Game.System("NetRewind/Move", {
  resources: { inputs: Game.System.readResource(Inputs), position: Game.System.writeResource(Position) },
  services: { physics: Game.System.service(Physics) }
}, ({ resources, services }) => {
  const world = services.physics.current
  for (const input of resources.inputs.get()) world.step(input.dx)
  resources.position.set(world.x)
})

const simulate = Game.Schedule(
  InputCapture.system(Game, { name: "NetRewind/Capture", source: Seats, resource: Inputs }),
  Clock.system(Game, { name: "NetRewind/Clock", resource: Time }),
  Move
)

const makePeer = () => {
  const seats = Netcode.seats(PlayerInput, { count: 2, idle })
  if (!seats.ok) throw new Error(seats.error.reason)
  const physics = makeWorld()
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Seats, seats.value.source), Game.Runtime.service(Physics, physics.world)),
    resources: { Inputs: [idle, idle], Time: Clock.start(step), Position: 0 }
  })
  if (!made.ok) throw new Error("the starting resources did not validate")
  return { runtime: made.value, seats: seats.value, physics }
}

describe("Netcode.rollback with a rewindable service", () => {
  it("rolls the library's world back with the ECS world, so every peer ends on the same one", () => {
    const hostClock = HostClock.test()
    const links = MemoryNetworkLink.make({ peers: 2, hostClock, seed: 3, latencyMS: 60, jitterMS: 40, loss: 0 })
    if (!links.ok) throw new Error(links.error.field)
    const peers = [0, 1].map((seat) => {
      const peer = makePeer()
      const session = Netcode.rollback(peer.runtime, { seats: peer.seats, seat, links: [links.value[seat]!], hostClock, step, simulate })
      if (!session.ok) throw new Error(session.error.reason)
      return { ...peer, session: session.value }
    })

    for (let at = 0; at < 300; at++) {
      for (const [seat, peer] of peers.entries()) {
        const advanced = peer.session.advance(at < 200 ? pressed(seat, at) : idle)
        if (!advanced.ok) throw new Error(`seat ${seat} at frame ${at}: ${JSON.stringify(advanced.error)}`)
      }
      if (!hostClock.adjust(step.dt * 1000).ok) throw new Error("the test clock did not move")
    }

    const [host, guest] = peers
    expect(host!.session.status().rollbacks).toBeGreaterThan(0)
    // One restore per rollback, and one when the session checks its checkpoint window at start.
    expect(host!.physics.counts.restores).toBe(host!.session.status().rollbacks + 1)
    // Every peer verified its checksums against the others', and agrees on the library's world too.
    expect(host!.session.status().verified).toBeGreaterThan(100)
    const tick = Math.min(host!.session.status().tick, guest!.session.status().tick)
    // One step per seat per tick: a rollback that left the world as it was would have stepped it again.
    expect(host!.physics.world.current.history.length).toBe(2 * host!.session.status().tick)
    expect(host!.physics.world.current.history.slice(0, 2 * tick)).toEqual(guest!.physics.world.current.history.slice(0, 2 * tick))
  })
})
