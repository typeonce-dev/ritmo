import { Descriptor, Entity, Result, Schema } from "@typeonce/ritmo"
import * as Command from "@typeonce/ritmo/Command"
import * as Codecs from "../test/codecs.ts"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ x: number; y: number }>()("Position")
const Velocity = Descriptor.Component<{ x: number; y: number }>()("Velocity")
const Time = Descriptor.Resource<number>()("Time")
const SafePosition = Descriptor.ConstructedComponent(Codecs.safeVector)("SafePosition")

const Game = Schema.bind(Schema.fragment({
  components: {
    Position,
    Velocity,
    SafePosition
  },
  resources: {
    Time
  }
}))
const schema = Game.schema

describe("Command", () => {
  it("bound spawnWith infers the schema without an explicit generic", () => {
    const draft = Game.Command.spawn(
      [Position, { x: 0, y: 0 }],
      [Velocity, { x: 1, y: 1 }]
    )

    expect(draft).type.toBe<Entity.EntityDraft<typeof schema, {
      readonly Position: { x: number; y: number }
      readonly Velocity: { x: number; y: number }
    }, typeof schema>>()
  })

  it("spawn starts with an empty draft proof", () => {
    const draft = Command.spawn<typeof schema>()

    expect(draft).type.toBe<Entity.EntityDraft<typeof schema, {}>>()
  })

  it("insertMany widens an existing draft proof", () => {
    const draft = Command.extend(
      Command.spawn<typeof schema>(),
      [Position, { x: 0, y: 0 }] as const,
      [Velocity, { x: 1, y: 1 }] as const
    )

    expect(draft).type.toBe<Entity.EntityDraft<typeof schema, {
      readonly Position: { x: number; y: number }
      readonly Velocity: { x: number; y: number }
    }>>()
  })

  it("rejects wrong component value types", () => {
    expect(Game.Command.spawn).type.not.toBeCallableWith([Position, { x: "0", y: 0 }])
    expect(Game.Command.spawn).type.toBeCallableWith([Position, { x: 0, y: 0 }])
  })

  it("rejects non-component descriptors", () => {
    // @ts-expect-error Type '"resource"' is not assignable to type '"component"'.
    Command.entry(Time, 1)
  })

  it("spawn with plain and raw entries preserves proof typing and plain entry slots", () => {
    const Game = Schema.bind(schema)

    const draft = Game.Command.spawn(
      Game.Command.entry(Position, { x: 0, y: 0 }),
      Game.Command.entryRaw(SafePosition, { x: 1, y: 1 })
    )

    expect(draft).type.toBe<Result.Result<Entity.EntityDraft<typeof schema, {
      readonly Position: { x: number; y: number }
      readonly SafePosition: Codecs.SafeVector
    }, typeof schema>, readonly [null, Descriptor.SchemaIssues | null]>>()
  })

  it("has no entryResult: validation goes through the descriptor", () => {
    expect(Game.Command).type.not.toHaveProperty("entryResult")
    expect(Command).type.not.toHaveProperty("entryResult")
  })

  it("entryRaw entries make insert return a Result with per-entry errors", () => {
    const Game = Schema.bind(schema)

    const entry = Game.Command.entryRaw(SafePosition, { x: 0, y: 0 })
    expect(entry).type.toBe<Result.Result<Command.Entry<typeof SafePosition>, Descriptor.SchemaIssues>>()

    const inserted = Game.Command.extend(
      Game.Command.spawn([Position, { x: 1, y: 1 }]), Game.Command.entryRaw(SafePosition, { x: 2, y: 3 }))

    expect(inserted).type.toBe<Result.Result<Entity.EntityDraft<typeof schema, {
      readonly Position: { x: number; y: number }
      readonly SafePosition: Codecs.SafeVector
    }, typeof schema>, readonly [Descriptor.SchemaIssues | null]>>()
  })

  it("entryRaw rejects plain component descriptors", () => {
    const Game = Schema.bind(schema)

    // @ts-expect-error Type 'Descriptor<"component", "Position", { x: number; y: number; }>' is missing the following properties
    Game.Command.entryRaw(Position, { x: 0, y: 0 })
  })
})
