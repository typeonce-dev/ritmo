import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"

const Health = Descriptor.ConstructedComponent(Codecs.struct({ hp: Codecs.number, name: Codecs.string }))("Meta/Health", {
  meta: { hp: { unit: "points", range: [0, 100], hint: "Hit points left; 0 despawns the entity." }, name: { hint: "Shown above the bar." } }
})
const Position = Descriptor.Component<{ readonly x: number }>()("Meta/Position", { immutable: true, meta: { x: { unit: "px" } } })
const Sprite = Descriptor.TransientComponent<{ readonly frame: number }>()("Meta/Sprite", { meta: { frame: { range: [0, 7] } } })
const Plain = Descriptor.Component<{ readonly x: number }>()("Meta/Plain")
const Tuning = Descriptor.ConstructedResource(Codecs.struct({ speed: Codecs.number }))("Meta/Tuning", {
  meta: { speed: { unit: "px/s", range: [0, 400] } }
})
const Wind = Descriptor.Resource<{ readonly force: number }>()("Meta/Wind", { meta: { force: { unit: "N" } } })
const Frame = Descriptor.TransientResource<{ readonly index: number }>()("Meta/Frame", { meta: { index: { hint: "Frames since start." } } })

const Game = Schema.bind(Schema.fragment({
  components: { Health, Position, Sprite, Plain },
  resources: { Tuning, Wind, Frame }
}))

const makeRuntime = (speed: number) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: { Tuning: { speed }, Wind: { force: 1 }, Frame: { index: 0 } },
    debug: { hostClock: HostClock.test() }
  })
  if (!made.ok) throw new Error("invalid fixture")
  return made.value
}

describe("descriptor meta", () => {
  it("is listed by describe(), per component and resource", () => {
    const description = makeRuntime(100).debug.describe()
    const components = Object.fromEntries(description.components.map((component) => [component.name, component.meta]))
    const resources = Object.fromEntries(description.resources.map((resource) => [resource.name, resource.meta]))
    expect(components).toEqual({
      "Meta/Health": { hp: { unit: "points", range: [0, 100], hint: "Hit points left; 0 despawns the entity." }, name: { hint: "Shown above the bar." } },
      "Meta/Position": { x: { unit: "px" } },
      "Meta/Sprite": { frame: { range: [0, 7] } },
      "Meta/Plain": {}
    })
    expect(resources).toEqual({
      "Meta/Tuning": { speed: { unit: "px/s", range: [0, 400] } },
      "Meta/Wind": { force: { unit: "N" } },
      "Meta/Frame": { index: { hint: "Frames since start." } }
    })
    expect(description.components.find((component) => component.name === "Meta/Position")?.immutable).toBe(true)
  })

  it("is frozen", () => {
    const meta = makeRuntime(100).debug.describe().components.find((component) => component.name === "Meta/Health")!.meta
    expect(Object.isFrozen(meta)).toBe(true)
    expect(Object.isFrozen(meta["hp"])).toBe(true)
    expect(Object.isFrozen(meta["hp"]?.range)).toBe(true)
  })

  it("is not validation: values outside the range are stored as they are", () => {
    const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Tuning: { speed: 999 }, Wind: { force: 1 }, Frame: { index: 0 } } })
    expect(made.ok).toBe(true)
  })

  it("is not saved: snapshots and restores are the same with and without it", () => {
    // Saved descriptors only: a plain resource does not snapshot.
    const Saved = Schema.bind(Schema.fragment({ components: { Health, Sprite }, resources: { Tuning, Frame } }))
    const make = (speed: number) => {
      const made = Saved.Runtime.make({ services: Saved.Runtime.services(), resources: { Tuning: { speed }, Frame: { index: 0 } } })
      if (!made.ok) throw new Error("invalid fixture")
      return made.value
    }
    const runtime = make(120)
    const snapshot = runtime.snapshot()
    expect(snapshot.ok).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain("px/s")
    const other = make(5)
    expect(snapshot.ok && other.restore(snapshot.value).ok).toBe(true)
    expect(other.snapshot()).toEqual(snapshot)
  })

  it("throws, naming the descriptor, on a malformed option from an unchecked caller", () => {
    const make = Descriptor.Component<{ readonly hp: number }>() as (name: string, options?: unknown) => unknown
    expect(() => make("Meta/BadRange", { meta: { hp: { range: [10, 0] } } })).toThrow(
      "Meta/BadRange: meta.hp.range must be [min, max] with finite numbers and min <= max, got [10,0]"
    )
    expect(() => make("Meta/BadKey", { meta: { hp: { units: "points" } } })).toThrow(
      "Meta/BadKey: meta.hp has an unknown key \"units\": a field's meta has only unit, range, and hint"
    )
    expect(() => make("Meta/BadUnit", { meta: { hp: { unit: "" } } })).toThrow("Meta/BadUnit: meta.hp.unit must be a non-empty string, got \"\"")
    expect(() => make("Meta/BadMeta", { meta: [] })).toThrow("Meta/BadMeta: meta must be an object keyed by the value's fields, got []")
    const resource = Descriptor.Resource<{ readonly hp: number }>() as (name: string, options?: unknown) => unknown
    expect(() => resource("Meta/BadField", { meta: { hp: 3 } })).toThrow("Meta/BadField: meta.hp must be an object with unit, range, or hint, got 3")
  })
})
