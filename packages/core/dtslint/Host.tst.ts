import { Descriptor, Entity, Schema } from "@typeonce/ritmo"
import { describe, expect, it } from "tstyche"

const Ping = Descriptor.Event<number>()("Types/Ping")
const Outside = Descriptor.Event<number>()("Types/Outside")
const Ready = Descriptor.Resource<boolean>()("Types/Ready")
const Position = Descriptor.Component<number>()("Types/Position")
const Root = Schema.defineRoot("HostTypes")
const Game = Schema.bind(Schema.fragment({ events: { Ping }, resources: { Ready }, components: { Position } }), Root)
const ready = Game.Condition.check("Types/Ready", { resources: { ready: Game.System.readResource(Ready) } }, ({ resources }) => resources.ready.get())

describe("host APIs", () => {
  it("infers local state and requires a factory", () => {
    Game.System("Types/Local", { local: () => ({ buffer: new Array<number>() }) }, ({ local }) => {
      expect(local).type.toBe<{ buffer: Array<number> }>()
      local.buffer.push(1)
      // @ts-expect-error Property 'missing' does not exist
      local.missing
    })
    Game.System("Types/NoLocal", {}, ({ local }) => { expect(local).type.toBe<undefined>() })
    const optional: { local?: () => { runs: number } } = {}
    Game.System("Types/OptionalLocal", optional, ({ local }) => {
      expect(local).type.toBe<{ runs: number } | undefined>()
      // @ts-expect-error 'local' is possibly 'undefined'
      local.runs++
      if (local !== undefined) local.runs++
    })
    const conditional = (access: { local: () => { runs: number } } | {}) => {
      Game.System("Types/ConditionalLocal", access, ({ local }) => {
        expect(local).type.toBe<{ runs: number } | undefined>()
      })
    }
    conditional({})
    conditional({ local: () => ({ runs: 0 }) })
    // @ts-expect-error is not assignable to type '() => unknown'
    Game.System("Types/BadFactory", { local: {} }, () => {})
  })

  it("carries pause requirements through nesting and rejects foreign conditions", () => {
    const system = Game.System("Types/Run", {}, () => {})
    const gated = Game.Schedule.when([ready], Game.Schedule.pauseWhen([ready], system))
    const missing = Game.Runtime.make({ services: Game.Runtime.services() }).success
    // @ts-expect-error __runtimeRequirementError__: "Missing resource"
    missing.tick(gated)
    const supplied = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Ready: true } }).success
    supplied.tick(gated)
    const Other = Schema.bind(Schema.fragment({ resources: { Ready } }), Schema.defineRoot("Other"))
    const mode = Other.StateMachine("Other/Mode", ["Playing"])
    // @ts-expect-error Type '"Other"' is not assignable to type '"HostTypes"'.
    Game.Schedule.pauseWhen([Other.Condition.inState(mode, "Playing")], system)
  })

  it("accepts only schema events and their payloads", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).success
    expect(runtime.send(Ping, 1)).type.toBe<void>()
    // @ts-expect-error is not assignable to parameter of type 'number'
    runtime.send(Ping, "bad")
    // @ts-expect-error is not assignable to parameter of type
    runtime.send(Outside, 1)
    // @ts-expect-error is not assignable to parameter of type
    runtime.send(Ready, true)
  })

  it("keeps numeric brands, roots, ids, and intents distinct", () => {
    const id = Entity.makeEntityId<typeof Game.schema, typeof Root>(1)
    const handle = Game.Entity.handle(id, Position)
    expect(id).type.toBeAssignableTo<number>()
    expect(handle).type.toBe<Entity.Handle<typeof Root, typeof Position>>()
    expect(handle).type.toBeAssignableTo<number>()
    expect<number>().type.not.toBeAssignableTo<typeof id>()
    expect<number>().type.not.toBeAssignableTo<typeof handle>()
    expect<typeof handle>().type.not.toBeAssignableTo<typeof id>()
    expect<Entity.Handle<Schema.RootToken<"Other">, typeof Position>>().type.not.toBeAssignableTo<typeof handle>()
    const Health = Descriptor.Component<number>()("Types/Health")
    expect<Entity.Handle<typeof Root, typeof Health>>().type.not.toBeAssignableTo<typeof handle>()
  })
})
