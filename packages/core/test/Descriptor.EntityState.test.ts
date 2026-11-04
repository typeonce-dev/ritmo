import { describe, expect, it } from "vitest"
import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"
import { worldOf } from "./saved.ts"

const Contact = Descriptor.EntityState("State/Contact", {
  ground: Codecs.struct({ platform: Codecs.nullable(Codecs.integer) }),
  crouch: {},
  air: Codecs.struct({ vy: Codecs.number, coyote: Codecs.integer })
}, { transitions: { ground: ["air", "crouch"], crouch: ["ground"], air: ["ground"] } })
const Mode = Descriptor.EntityState("State/Mode", { a: {}, b: Codecs.struct({ n: Codecs.number }), c: {} })

const Game = Schema.bind(Schema.fragment({ components: { Contact, Mode } }))

const Contacts = Game.Query({ selection: { contact: Game.Query.write(Contact) } })
const ReadContacts = Game.Inspector("State/ReadContacts", {
  queries: { contacts: Game.Query({ selection: { contact: Game.Query.read(Contact) } }) }
}, ({ queries }) => queries.contacts.each().map((entity) => queries.contacts.data.contact.get(entity)))

const makeRuntime = () => {
  const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).value
  const Spawn = Game.System("State/Spawn", {
    commands: Game.System.commands(Game.System.spawns(Contact, Mode))
  }, ({ commands }) => {
    commands.spawn(Game.Command.spawn([Contact, { _tag: "ground", platform: 3 }], [Mode, { _tag: "a" }]))
  })
  runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
  return runtime
}

describe("Descriptor.EntityState", () => {
  it("moves between states with a compare-and-set that writes only the target's fields", () => {
    const runtime = makeRuntime()
    const results: Array<unknown> = []
    const Jump = Game.System("State/Jump", { queries: { contacts: Contacts } }, ({ queries }) => {
      const { data } = queries.contacts
      for (const entity of queries.contacts.each()) {
        results.push(data.contact.transition(entity, { from: "ground", to: "air", data: { vy: 2, coyote: 0 } }))
        // Stale: the contact is no longer "ground", so nothing is written.
        results.push(data.contact.transition(entity, { from: "ground", to: "air", data: { vy: 9, coyote: 9 } }))
      }
    })
    runtime.tick(Game.Schedule(Jump))
    expect(results).toEqual([
      { ok: true, value: undefined },
      { ok: false, error: { _tag: "EntityStateMismatch", component: "State/Contact", expected: "ground", actual: "air" } }
    ])
    // The ground's platform does not survive the move.
    expect(runtime.inspect(ReadContacts)).toEqual([{ _tag: "air", vy: 2, coyote: 0 }])
  })

  it("changes the current state's fields with update, and fails in another state", () => {
    const runtime = makeRuntime()
    const results: Array<unknown> = []
    const Fall = Game.System("State/Fall", { queries: { contacts: Contacts } }, ({ queries }) => {
      const { data } = queries.contacts
      for (const entity of queries.contacts.each()) {
        results.push(data.contact.update(entity, { state: "air", data: (air) => ({ ...air, vy: air.vy - 1 }) }))
        data.contact.transition(entity, { from: "ground", to: "air", data: { vy: 2, coyote: 0 } })
        results.push(data.contact.update(entity, { state: "air", data: (air) => ({ ...air, vy: air.vy - 1 }) }))
        results.push(data.contact.update(entity, { state: "air", data: (air) => ({ vy: air.vy - 1, coyote: 4 }) }))
      }
    })
    runtime.tick(Game.Schedule(Fall))
    expect(results).toEqual([
      { ok: false, error: { _tag: "EntityStateMismatch", component: "State/Contact", expected: "air", actual: "ground" } },
      { ok: true, value: undefined },
      { ok: true, value: undefined }
    ])
    const [contact] = runtime.inspect(ReadContacts)
    expect(contact).toEqual({ _tag: "air", vy: 0, coyote: 4 })
    // `_tag` stays the first key, as a transition writes it.
    expect(Object.keys(contact!)[0]).toBe("_tag")
  })

  it("writes one shared value for a state without fields", () => {
    const runtime = makeRuntime()
    const seen: Array<unknown> = []
    const Crouch = Game.System("State/Crouch", { queries: { contacts: Contacts } }, ({ queries }) => {
      const { data } = queries.contacts
      for (const entity of queries.contacts.each()) {
        data.contact.transition(entity, { from: "ground", to: "crouch" })
        seen.push(data.contact.get(entity))
        data.contact.transition(entity, { from: "crouch", to: "ground", data: { platform: null } })
        data.contact.transition(entity, { from: "ground", to: "crouch" })
        seen.push(data.contact.get(entity))
      }
    })
    runtime.tick(Game.Schedule(Crouch))
    expect(seen[0]).toEqual({ _tag: "crouch" })
    expect(seen[0]).toBe(seen[1])
    expect(Object.isFrozen(seen[0])).toBe(true)
  })

  it("accepts any pair of states without a transition graph", () => {
    const runtime = makeRuntime()
    const Jump = Game.System("State/Wander", {
      queries: { modes: Game.Query({ selection: { mode: Game.Query.write(Mode) } }) }
    }, ({ queries }) => {
      const { data } = queries.modes
      for (const entity of queries.modes.each()) {
        data.mode.transition(entity, { from: "a", to: "c" })
        data.mode.transition(entity, { from: "c", to: "b", data: { n: 1 } })
      }
    })
    const ReadModes = Game.Inspector("State/ReadModes", {
      queries: { modes: Game.Query({ selection: { mode: Game.Query.read(Mode) } }) }
    }, ({ queries }) => queries.modes.each().map((entity) => queries.modes.data.mode.get(entity)))
    runtime.tick(Game.Schedule(Jump))
    expect(runtime.inspect(ReadModes)).toEqual([{ _tag: "b", n: 1 }])
  })

  it("is an ordinary write: change detection sees it and a failed system rolls it back", () => {
    const runtime = makeRuntime()
    const Fail = Game.System("State/Fail", { queries: { contacts: Contacts } }, ({ queries }) => {
      const { data } = queries.contacts
      for (const entity of queries.contacts.each()) data.contact.transition(entity, { from: "ground", to: "crouch" })
      return Result.failure("Rejected" as const)
    })
    expect(runtime.tick(Game.Schedule(Fail)).ok).toBe(false)
    expect(runtime.inspect(ReadContacts)).toEqual([{ _tag: "ground", platform: 3 }])

    const changed: Array<number> = []
    const Crouch = Game.System("State/CrouchOnce", { queries: { contacts: Contacts } }, ({ queries }) => {
      const { data } = queries.contacts
      for (const entity of queries.contacts.each()) data.contact.transition(entity, { from: "ground", to: "crouch" })
    })
    const Watch = Game.System("State/Watch", {
      queries: {
        changed: Game.Query({ selection: { contact: Game.Query.read(Contact) }, filters: [Game.Query.changed(Contact)] })
      }
    }, ({ queries }) => {
      changed.push(queries.changed.each().length)
    })
    runtime.tick(Game.Schedule(Watch))
    runtime.tick(Game.Schedule(Crouch, Watch))
    runtime.tick(Game.Schedule(Watch))
    expect(changed).toEqual([1, 1, 0])
  })

  it("validates setRaw, and decodes each state's fields in snapshots", () => {
    const runtime = makeRuntime()
    const results: Array<unknown> = []
    const Raw = Game.System("State/Raw", { queries: { contacts: Contacts } }, ({ queries }) => {
      const { data } = queries.contacts
      for (const entity of queries.contacts.each()) {
        results.push(
          data.contact.setRaw(entity, { _tag: "air", vy: 1, coyote: 2 }).ok,
          data.contact.setRaw(entity, { _tag: "swim" } as never),
          data.contact.setRaw(entity, { _tag: "air", vy: "fast" } as never)
        )
      }
    })
    runtime.tick(Game.Schedule(Raw))
    expect(results).toEqual([
      true,
      { ok: false, error: { _tag: "SchemaIssues", issues: [{ message: "Expected \"ground\" | \"crouch\" | \"air\"", path: ["_tag"] }] } },
      { ok: false, error: { _tag: "SchemaIssues", issues: [{ message: "Expected a finite number", path: ["vy"] }] } }
    ])

    const snapshot = worldOf(runtime.snapshot())
    const entity = snapshot.entities[0]!
    const restoreWith = (contact: unknown) =>
      runtime.restore({ ...snapshot, entities: [{ ...entity, components: { ...entity.components, "State/Contact": contact } }] })
    const unknownState = restoreWith({ _tag: "swim" })
    expect(unknownState.ok ? undefined : unknownState.error._tag).toBe("InvalidComponent")
    // The fields of another state do not decode as this one's.
    const wrongFields = restoreWith({ _tag: "ground", vy: 1, coyote: 2 })
    expect(wrongFields.ok ? undefined : wrongFields.error._tag).toBe("InvalidComponent")
    // A field another state has is dropped on load, so a save cannot carry it into this state.
    expect(restoreWith({ _tag: "ground", platform: 1, vy: 4 }).ok).toBe(true)
    expect(runtime.inspect(ReadContacts)).toEqual([{ _tag: "ground", platform: 1 }])

    expect(runtime.restore(JSON.parse(JSON.stringify(snapshot))).ok).toBe(true)
    expect(runtime.inspect(ReadContacts)).toEqual([{ _tag: "air", vy: 1, coyote: 2 }])
  })
})
