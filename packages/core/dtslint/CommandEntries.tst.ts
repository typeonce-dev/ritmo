import { Descriptor, Random, Schema } from "@typeonce/ritmo"
import * as Codecs from "../test/codecs.ts"
import { describe, expect, it } from "tstyche"

type Shape = { readonly kind: "circle"; readonly radius: number } | { readonly kind: "box"; readonly width: number }

const Hp = Descriptor.Component<number>()("Entries/Hp")
const Name = Descriptor.Component<string>()("Entries/Name")
const Phase = Descriptor.EntityState("Entries/Phase", { ready: {}, windup: Codecs.struct({ frames: Codecs.integer }) })
const Stranger = Descriptor.Component<number>()("Entries/Stranger")
const Position = Descriptor.Component<{ x: number; y: number }>()("Entries/Position")
const Velocity = Descriptor.Component<{ x: number; y: number }>()("Entries/Velocity")
const Path = Descriptor.Component<Array<number>>()("Entries/Path")
const Pair = Descriptor.Component<readonly [number, string]>()("Entries/Pair")
const Scores = Descriptor.Component<Record<string, number>>()("Entries/Scores")
const Body = Descriptor.Component<Shape>()("Entries/Body")
const Named = Descriptor.Component<{ x: number; label?: string }>()("Entries/Named")
const Seen = Descriptor.Component<ReadonlySet<string>>()("Entries/Seen")
const Lookup = Descriptor.Component<ReadonlyMap<string, number>>()("Entries/Lookup")
const Ease = Descriptor.Component<(t: number) => number>()("Entries/Ease")
const Loose = Descriptor.Component<unknown>()("Entries/Loose")
const Maybe = Descriptor.Component<{ x: number } | null>()("Entries/Maybe")
const Seed = Descriptor.Component<Random.State>()("Entries/Seed")
const Safe = Descriptor.ConstructedComponent(Codecs.struct({ x: Codecs.number, y: Codecs.number }))("Entries/Safe")
const Config = Descriptor.Resource<{ speed: number; debug: boolean }>()("Entries/Config")
const Tuning = Descriptor.ConstructedResource(Codecs.struct({ rate: Codecs.number }))("Entries/Tuning")
const Rng = Descriptor.ConstructedResource(Random.codec)("Entries/Rng")

const Root = Schema.defineRoot("Entries")
const Game = Schema.bind(Schema.fragment({
  components: { Hp, Name, Phase, Position, Velocity, Path, Pair, Scores, Body, Named, Seen, Lookup, Ease, Loose, Maybe, Seed, Safe },
  resources: { Config, Tuning, Rng }
}), Root)
const Positions = Game.Query({ selection: { position: Game.Query.read(Position) } })

describe("spawn and insert entries", () => {
  it("accept each descriptor with its own value", () => {
    expect(Game.Command.spawn([Hp, 1], [Name, "n"], [Phase, { _tag: "ready" }])).type.not.toRaiseError()
    expect(Game.Command.extend(Game.Command.spawn([Hp, 1]), [Name, "n"])).type.not.toRaiseError()
  })

  it("accept every shape a value can have, typed by its component where written", () => {
    const at = { x: 1, y: 2 }
    expect(Game.Command.spawn(
      [Position, at],
      [Path, []],
      [Pair, [1, "a"]],
      [Scores, { any: 1, key: 2 }],
      [Body, { kind: "box", width: 2 }],
      [Named, { x: 1 }],
      [Seen, new Set()],
      [Lookup, new Map([["a", 1]])],
      [Ease, (t) => t * 2],
      [Loose, { anything: 1 }],
      [Maybe, null],
      [Seed, Random.seed(1)],
      Game.Command.entryRaw(Safe, { x: 1, y: 2 })
    )).type.not.toRaiseError()
    expect(Game.Command.spawn([Named, { x: 1, label: "a" }], [Maybe, { x: 0 }], [Body, { kind: "circle", radius: 1 }])).type.not.toRaiseError()
    const entries: ReadonlyArray<readonly [typeof Hp, number] | readonly [typeof Name, string]> = [[Hp, 1], [Name, "n"]]
    expect(Game.Command.spawn(...entries)).type.not.toRaiseError()
    expect(Game.Command.spawn(...(Math.random() > 0.5 ? [[Hp, 1] as const] : []), [Name, "n"])).type.not.toRaiseError()
  })

  it("reject a value that belongs to another component of the schema", () => {
    expect(Game.Command.spawn).type.not.toBeCallableWith([Hp, "x"])
    expect(Game.Command.spawn).type.not.toBeCallableWith([Hp, 1], [Name, 2])
    expect(Game.Command.spawn).type.not.toBeCallableWith([Phase, { _tag: "windup" }])
    expect(Game.Command.extend).type.not.toBeCallableWith(Game.Command.spawn([Hp, 1]), [Name, 3])
  })

  it("reject descriptors outside the schema", () => {
    expect(Game.Command.spawn).type.not.toBeCallableWith([Stranger, 1])
  })
})

describe("an entry is checked against its own component", () => {
  it("names the component and the field it does not have", () => {
    // @ts-expect-error Entries/Position has no field z: pass only its own fields
    Game.Command.spawn([Position, { x: 1, y: 2, z: 3 }])
    // @ts-expect-error Entries/Named has no field lable: pass only its own fields
    Game.Command.extend(Game.Command.spawn([Hp, 1]), [Named, { x: 1, lable: "a" }])
    const spread = { x: 1, y: 2 }
    // @ts-expect-error Entries/Position has no field extra: pass only its own fields
    Game.Command.spawn([Position, { ...spread, extra: true }])
    Game.Command.spawn([Position, { x: 1, y: 2 }])
    // As for `update`, a union of shapes takes any field of any member.
    Game.Command.spawn([Body, { kind: "box", width: 2, radius: 1 }])
  })

  it("names the component of a value with a missing field", () => {
    // @ts-expect-error '{ readonly x: number; readonly y: number; } & ValueOf<"Entries/Position">'
    Game.Command.spawn([Position, { x: 1 }])
    // @ts-expect-error Property 'y' is missing in type '{ x: number; }'
    Game.Command.spawn([Velocity, { x: 1 }])
  })

  it("names the component and the field of a value of another type", () => {
    // @ts-expect-error Type 'string' is not assignable to type 'number & FieldOf<"Entries/Position", "y">'
    Game.Command.spawn([Position, { x: 1, y: "2" }])
    // @ts-expect-error Type 'string' is not assignable to type 'number & ValueOf<"Entries/Hp">'
    Game.Command.spawn([Hp, "full"])
    // @ts-expect-error Type 'number' is not assignable to type 'string & FieldOf<"Entries/Named", "label">'
    Game.Command.spawn([Named, { x: 1, label: 2 }])
  })

  it("says a descriptor is not a component of this game", () => {
    // @ts-expect-error Entries/Stranger is not a component of this game's schema: spawn and insert take components registered in Schema.fragment({ components: { ... } })
    Game.Command.spawn([Stranger, 1])
    // @ts-expect-error Entries/Config is not a component of this game's schema
    Game.Command.spawn([Config, { speed: 1, debug: false }])
  })

  it("checks inserts the same way", () => {
    Game.System("Entries/Insert", {
      queries: { positions: Positions },
      commands: Game.System.commands(Game.System.inserts(Position, Hp))
    }, ({ queries, commands }) => {
      for (const entity of queries.positions.each()) {
        commands.insert(entity, [Position, { x: 0, y: 0 }], [Hp, 1])
        // @ts-expect-error Entries/Position has no field zzz: pass only its own fields
        commands.insert(entity, [Position, { x: 0, y: 0, zzz: 1 }])
        // @ts-expect-error Type 'string' is not assignable to type 'number & ValueOf<"Entries/Hp">'
        commands.insert(entity, [Hp, "full"])
        // @ts-expect-error Entries/Stranger is not a component of this game's schema
        commands.insert(entity, [Stranger, 1])
        // @ts-expect-error Entries/Name is not declared in this system's commands: add it to Game.System.inserts(...)
        commands.insert(entity, [Name, "n"])
        const unchecked: any = 1
        commands.insert(entity, [Hp, unchecked])
        // @ts-expect-error Entries/Name is not declared in this system's commands: add it to Game.System.inserts(...)
        commands.insert(entity, [Name, unchecked])
      }
    })
  })

  it("leaves a component missing from spawns(...) to the spawn", () => {
    Game.System("Entries/Spawn", { commands: Game.System.commands(Game.System.spawns(Position)) }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Position, { x: 1, y: 2 }]))
      // @ts-expect-error Entries/Velocity is not declared in this system's commands: add it to Game.System.spawns(...)
      commands.spawn(Game.Command.spawn([Position, { x: 1, y: 2 }], [Velocity, { x: 1, y: 1 }]))
    })
  })

  it("has no entry builder: an entry is a tuple", () => {
    expect(Game.Command).type.not.toHaveProperty("entry")
    expect(Game.Command).type.toHaveProperty("entryRaw")
  })
})

describe("initial resources", () => {
  it("take each resource's own fields", () => {
    expect(Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: { Config: { speed: 1, debug: false }, Tuning: { rate: 2 }, Rng: Random.seed(1) }
    }).ok).type.toBe<boolean>()
  })

  it("name the resource and the field it does not have", () => {
    // @ts-expect-error Entries/Config has no field bogus: pass only its own fields
    Game.Runtime.make({ services: Game.Runtime.services(), resources: { Config: { speed: 1, debug: false, bogus: 2 } } })
    // @ts-expect-error Entries/Tuning has no field rat: pass only its own fields
    Game.Runtime.make({ services: Game.Runtime.services(), resources: { Tuning: { rate: 2, rat: 1 } } })
  })
})
