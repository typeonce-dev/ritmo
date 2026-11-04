import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Codecs from "../test/codecs.ts"
import type { EntityStateMismatchError } from "@typeonce/ritmo/Query"
import type * as Result from "@typeonce/ritmo/Result"
import { describe, expect, it } from "tstyche"

const Contact = Descriptor.EntityState("StateTypes/Contact", {
  ground: Codecs.struct({ platform: Codecs.nullable(Codecs.integer) }),
  crouch: {},
  air: Codecs.struct({ vy: Codecs.number, coyote: Codecs.integer })
}, { transitions: { ground: ["air", "crouch"], crouch: ["ground", "air"], air: ["ground"] } })
const Phase = Descriptor.EntityState("StateTypes/Phase", { ready: {}, windup: {}, active: {} }, {
  transitions: { ready: ["windup"], windup: ["active", "ready"], active: ["ready"] }
})
const Mode = Descriptor.EntityState("StateTypes/Mode", { a: {}, b: Codecs.struct({ n: Codecs.number }) })

type ContactValue =
  | { readonly _tag: "ground"; readonly platform: number | null }
  | { readonly _tag: "crouch" }
  | { readonly _tag: "air"; readonly vy: number; readonly coyote: number }
type Mismatch = Result.Result<void, EntityStateMismatchError<"ground" | "crouch" | "air">>

const Game = Schema.bind(Schema.fragment({ components: { Contact, Phase, Mode } }))
const Bodies = Game.Query({
  selection: { contact: Game.Query.write(Contact), phase: Game.Query.write(Phase), mode: Game.Query.write(Mode) }
})

describe("Descriptor.EntityState", () => {
  it("is a component whose value is a tagged union of its states", () => {
    expect<Descriptor.EntityStateOf<typeof Contact>>().type.toBe<ContactValue>()
    expect<Descriptor.EntityStateOf<typeof Contact, "air">>().type.toBe<{ readonly _tag: "air"; readonly vy: number; readonly coyote: number }>()
    expect<Descriptor.EntityStateOf<typeof Contact, "crouch">>().type.toBe<{ readonly _tag: "crouch" }>()
    // @ts-expect-error Type '"swim"' does not satisfy the constraint '"ground" | "crouch" | "air"'.
    type Unknown = Descriptor.EntityStateOf<typeof Contact, "swim">

    expect(Game.Command.spawn([Contact, { _tag: "ground", platform: null }], [Phase, { _tag: "ready" }], [Mode, { _tag: "a" }])).type.not.toRaiseError()
    expect(Game.Command.spawn).type.not.toBeCallableWith([Contact, { _tag: "swim" }])
    expect(Game.Command.spawn).type.not.toBeCallableWith([Contact, { _tag: "air", vy: 2 }])
  })

  it("reads a value that narrows on _tag", () => {
    Game.System("StateTypes/Read", { queries: { bodies: Bodies } }, ({ queries }) => {
      const { data } = queries.bodies
      for (const entity of queries.bodies.each()) {
        const contact = data.contact.get(entity)
        expect(contact).type.toBe<ContactValue>()
        if (contact._tag === "air") expect(contact.vy).type.toBe<number>()
        // @ts-expect-error Property 'vy' does not exist on type '{ readonly _tag: "ground"; readonly platform: number | null; }'.
        if (contact._tag === "ground") contact.vy
      }
    })
  })

  it("moves with transition({ from, to, data }): to's fields, checked against the graph", () => {
    Game.System("StateTypes/Move", { queries: { bodies: Bodies } }, ({ queries }) => {
      const { data } = queries.bodies
      for (const entity of queries.bodies.each()) {
        expect(data.contact.transition(entity, { from: "ground", to: "air", data: { vy: 2, coyote: 0 } })).type.toBe<Mismatch>()
        expect(data.contact.transition(entity, { from: "air", to: "ground", data: { platform: 1 } })).type.not.toRaiseError()
        expect(data.contact.transition(entity, { from: "ground", to: "crouch" })).type.not.toRaiseError()
        // Not an allowed move.
        // @ts-expect-error Type '"crouch"' is not assignable to type '"ground"'.
        data.contact.transition(entity, { from: "air", to: "crouch" })
        // Unknown states.
        expect(data.contact.transition).type.not.toBeCallableWith({ from: "swim", to: "ground", data: { platform: 1 } })
        // The target's fields are required, exactly.
        // @ts-expect-error Property 'data' is missing in type
        data.contact.transition(entity, { from: "air", to: "ground" })
        // @ts-expect-error Property 'coyote' is missing in type '{ vy: number; }' but required in type
        data.contact.transition(entity, { from: "ground", to: "air", data: { vy: 2 } })
        // @ts-expect-error Object literal may only specify known properties, and 'platform' does not exist in type
        data.contact.transition(entity, { from: "ground", to: "air", data: { vy: 2, coyote: 0, platform: 1 } })
        // A state without fields takes no data.
        // @ts-expect-error Type '{ platform: number; }' is not assignable to type 'never'.
        data.contact.transition(entity, { from: "ground", to: "crouch", data: { platform: 1 } })
        // With a union `from`, only the moves every one of them allows.
        const current = data.contact.get(entity)._tag as "ground" | "crouch"
        expect(data.contact.transition(entity, { from: current, to: "air", data: { vy: 2, coyote: 0 } })).type.not.toRaiseError()
        // @ts-expect-error Type '"crouch"' is not assignable to type '"air"'.
        data.contact.transition(entity, { from: current, to: "crouch" })
        // Without a graph any pair of states is accepted, unknown states are not.
        expect(data.mode.transition(entity, { from: "a", to: "b", data: { n: 1 } })).type.not.toRaiseError()
        expect(data.mode.transition(entity, { from: "b", to: "b", data: { n: 2 } })).type.not.toRaiseError()
        // @ts-expect-error Type '"c"' is not assignable to type '"a" | "b"'.
        data.mode.transition(entity, { from: "a", to: "c" })
        expect(data.phase.transition(entity, { from: "windup", to: "active" })).type.not.toRaiseError()
      }
    })
  })

  it("changes the current state's fields with update({ state, data })", () => {
    Game.System("StateTypes/Update", { queries: { bodies: Bodies } }, ({ queries }) => {
      const { data } = queries.bodies
      for (const entity of queries.bodies.each()) {
        expect(data.contact.update(entity, { state: "air", data: (air) => ({ ...air, vy: air.vy - 1 }) })).type.toBe<Mismatch>()
        expect(data.contact.update(entity, { state: "air", data: () => ({ vy: 1, coyote: 0 }) })).type.not.toRaiseError()
        data.contact.update(entity, {
          state: "air",
          data: (air) => {
            expect(air).type.toBe<{ readonly _tag: "air"; readonly vy: number; readonly coyote: number }>()
            return air
          }
        })
        // @ts-expect-error Property 'coyote' is missing in type '{ vy: number; }'
        data.contact.update(entity, { state: "air", data: () => ({ vy: 1 }) })
        // A field of another state does not compile, even through a spread.
        // @ts-expect-error air has no field platform
        data.contact.update(entity, { state: "air", data: (air) => ({ ...air, platform: 1 }) })
        // It cannot leave the state.
        // @ts-expect-error Type '"ground"' is not assignable to type '"air"'.
        data.contact.update(entity, { state: "air", data: (air) => ({ ...air, _tag: "ground" as const }) })
        // @ts-expect-error Type '"swim"' is not assignable to type '"ground" | "crouch" | "air"'.
        data.contact.update(entity, { state: "swim", data: (value) => value })
      }
    })
  })

  it("keeps set and setRaw for resets, and drops the unscoped writes", () => {
    Game.System("StateTypes/Reset", { queries: { bodies: Bodies } }, ({ queries }) => {
      const { data } = queries.bodies
      for (const entity of queries.bodies.each()) {
        expect(data.contact.set(entity, { _tag: "ground", platform: null })).type.not.toRaiseError()
        // @ts-expect-error Object literal may only specify known properties, and 'vy' does not exist in type
        data.contact.set(entity, { _tag: "ground", platform: null, vy: 1 })
        expect(data.contact.setRaw(entity, { _tag: "crouch" })).type.not.toRaiseError()
        expect(data.contact).type.not.toHaveProperty("updateRaw")
        // Three arguments: the positional form is gone.
        // @ts-expect-error Expected 2 arguments, but got 3.
        data.phase.transition(entity, "ready", "windup")
      }
    })
  })

  it("requires states with fields, a graph listing exactly the states, and no _tag field", () => {
    // Missing state.
    // @ts-expect-error Property 'b' is missing in type '{ a: "b"[]; }' but required in type 'EntityStateTransitions<{ readonly a: {}; readonly b: {}; }>'.
    Descriptor.EntityState("StateTypes/Missing", { a: {}, b: {} }, { transitions: { a: ["b"] } })
    // Unknown target.
    // @ts-expect-error Type '"c"' is not assignable to type '"a" | "b"'.
    Descriptor.EntityState("StateTypes/Target", { a: {}, b: {} }, { transitions: { a: ["c"], b: [] } })
    // Unknown source.
    // @ts-expect-error Type 'string[]' is not assignable to type 'never'.
    Descriptor.EntityState("StateTypes/Source", { a: {}, b: {} }, { transitions: { a: ["b"], b: [], c: ["a"] } })
    // Terminal states list no moves.
    expect(Descriptor.EntityState("StateTypes/Terminal", { a: {}, b: {} }, { transitions: { a: ["b"], b: [] } })).type.not.toRaiseError()
    // At least one state.
    // @ts-expect-error an entity state needs at least one state
    Descriptor.EntityState("StateTypes/Empty", {})
    // Data is one schema, not a record of fields.
    // @ts-expect-error a state is `{}` or one schema for all of its data: wrap the fields in your library's object schema
    Descriptor.EntityState("StateTypes/NotCodec", { a: { n: "number" } })
    // `_tag` is the state's name.
    // @ts-expect-error `_tag` holds the state's name: give this field another name
    Descriptor.EntityState("StateTypes/Tag", { a: Codecs.struct({ _tag: Codecs.string }) })
  })
})
