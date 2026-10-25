import { describe, expect, it } from "vitest"
import { Checkpoint, Descriptor, Result, Schema } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"

const expectOk = (result: { readonly ok: boolean; readonly error?: unknown }): void => {
  expect(result.ok ? undefined : result.error).toBeUndefined()
}

// A stand-in for a physics library that keeps its own world: mutable, stepped
// in place, saved to a copy and restored to a new world.
class Physics {
  constructor(public count: number, public readonly history: Array<number>) {}
  step(by: number): void {
    this.count += by
    this.history.push(this.count)
  }
}

interface Saved {
  readonly count: number
  readonly history: ReadonlyArray<number>
}

const makePhysics = (options: { readonly corrupt?: (saved: Saved) => boolean } = {}) => {
  const saves = { count: 0 }
  const physics = Checkpoint.rewindable(new Physics(0, []), {
    save: (world): Saved => {
      saves.count++
      return { count: world.count, history: world.history.slice() }
    },
    restore: (saved) =>
      options.corrupt?.(saved) === true
        ? Result.failure({ _tag: "CorruptSnapshot" as const, count: saved.count })
        : Result.success(new Physics(saved.count, saved.history.slice()))
  })
  return { physics, saves }
}

const Score = Descriptor.ConstructedResource(Codecs.number)("Rewindable/Score")
const PhysicsService = Descriptor.Service<ReturnType<typeof makePhysics>["physics"]>()("Rewindable/Physics")
const Game = Schema.bind(Schema.fragment({ resources: { Score } }), Schema.defineRoot("RewindableTest"))

// Steps the physics world and mirrors what gameplay reads into a resource.
const Step = Game.System("Rewindable/Step", {
  resources: { score: Game.System.writeResource(Score) },
  services: { physics: Game.System.service(PhysicsService) }
}, ({ resources, services }) => {
  services.physics.current.step(1)
  resources.score.set(services.physics.current.count)
})
const simulate = Game.Schedule(Step)
const ReadScore = Game.Inspector("Rewindable/ReadScore", {
  resources: { score: Game.System.readResource(Score) }
}, ({ resources }) => resources.score.get())

const makeRuntime = (physics: ReturnType<typeof makePhysics>["physics"]) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(PhysicsService, physics)),
    resources: { Score: 0 }
  })
  if (!made.ok) throw new Error("the resources did not validate")
  return made.value
}

describe("Checkpoint.rewindable", () => {
  it("is recognized by isRewindable, and current cannot be overwritten", () => {
    const { physics } = makePhysics()
    expect(Checkpoint.isRewindable(physics)).toBe(true)
    expect(Checkpoint.isRewindable({ current: 1 })).toBe(false)
    expect(() => {
      (physics as { current: unknown }).current = new Physics(9, [])
    }).toThrow()
  })

  it("is saved by every checkpoint and restored by a rewind, which systems then see", () => {
    const { physics, saves } = makePhysics()
    const runtime = makeRuntime(physics)
    const before = physics.current
    expectOk(runtime.tick(simulate))
    const checkpoint = runtime.checkpoint(simulate)
    expect(saves.count).toBe(1)
    expectOk(runtime.tick(simulate))
    expectOk(runtime.tick(simulate))
    expect(physics.current.history).toEqual([1, 2, 3])

    expectOk(runtime.rewind(checkpoint))
    expect(physics.current).not.toBe(before)
    expect(physics.current.count).toBe(1)
    expect(physics.current.history).toEqual([1])

    // Ticking again from the checkpoint gives the same history, through the restored value.
    expectOk(runtime.tick(simulate))
    expectOk(runtime.tick(simulate))
    expect(physics.current.history).toEqual([1, 2, 3])
    expect(runtime.inspect(ReadScore)).toBe(3)

    // The checkpoint stays usable: its save restores again.
    expectOk(runtime.rewind(checkpoint))
    expect(physics.current.history).toEqual([1])
  })

  it("fails a rewind with RestoreFailed, changing nothing, when restore fails", () => {
    const { physics } = makePhysics({ corrupt: (saved) => saved.count === 1 })
    const runtime = makeRuntime(physics)
    expectOk(runtime.tick(simulate))
    const checkpoint = runtime.checkpoint(simulate)
    expectOk(runtime.tick(simulate))
    const live = physics.current

    const rewound = runtime.rewind(checkpoint)
    expect(rewound).toEqual({
      ok: false,
      error: { _tag: "RestoreFailed", service: "Rewindable/Physics", error: { _tag: "CorruptSnapshot", count: 1 } }
    })
    if (!rewound.ok && rewound.error._tag === "RestoreFailed") {
      expect(rewound.error.error.count).toBe(1)
    }
    expect(physics.current).toBe(live)
    expect(runtime.inspect(ReadScore)).toBe(2)
  })

  it("frees the saves of released checkpoints with them", () => {
    const { physics, saves } = makePhysics()
    const runtime = makeRuntime(physics)
    const taken: Array<ReturnType<typeof runtime.checkpoint>> = []
    for (let tick = 0; tick < Checkpoint.defaultWindow + 1; tick++) {
      taken.push(runtime.checkpoint(simulate))
      expectOk(runtime.tick(simulate))
    }
    expect(saves.count).toBe(Checkpoint.defaultWindow + 1)
    expect(runtime.rewind(taken[0]!)).toEqual({ ok: false, error: { _tag: "Released", reason: "window" } })
    expectOk(runtime.rewind(taken[1]!))
    expect(physics.current.count).toBe(1)
  })

  it("is not saved by snapshots: restoring a save leaves the service as it is", () => {
    const { physics } = makePhysics()
    const runtime = makeRuntime(physics)
    expectOk(runtime.tick(simulate))
    const save = runtime.snapshot()
    if (!save.ok) throw new Error("the snapshot failed")
    expect(JSON.stringify(save.value)).not.toContain("history")
    expectOk(runtime.tick(simulate))
    const live = physics.current
    expectOk(runtime.restore(save.value))
    expect(physics.current).toBe(live)
    expect(physics.current.count).toBe(2)
    expect(runtime.inspect(ReadScore)).toBe(1)
  })
})
