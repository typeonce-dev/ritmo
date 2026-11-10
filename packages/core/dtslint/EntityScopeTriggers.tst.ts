import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as EntityScope from "@typeonce/ritmo/EntityScope"
import { describe, expect, it } from "tstyche"

const Name = Descriptor.Component<string>()("ScopeTriggersTypes/Name")
const Root = Schema.defineRoot("ScopeTriggersTypes")
const Game = Schema.bind(Schema.fragment({ components: { Name } }), Root)
const OtherRoot = Schema.defineRoot("ScopeTriggersTypes/Other")
const OtherGame = Schema.bind(Schema.fragment({ resources: {} }), OtherRoot)
const Flow = Game.StateMachine("ScopeTriggersTypes/Flow", { Menu: {}, Playing: {} })
const OtherFlow = OtherGame.StateMachine("ScopeTriggersTypes/OtherFlow", { Idle: {} })

describe("Game.EntityScope triggers", () => {
  it("takes a machine of this game and one of its states", () => {
    const Run = Game.EntityScope("ScopeTriggersTypes/Run", { despawnOnExit: [Flow, "Playing"] })
    expect(Run).type.toBe<EntityScope.EntityScope<"ScopeTriggersTypes/Run", typeof Root>>()
    const Both = Game.EntityScope("ScopeTriggersTypes/Both", { despawnOnEnter: [Flow, "Menu"], despawnOnExit: [Flow, "Playing"] })
    expect(Both).type.toBe<EntityScope.EntityScope<"ScopeTriggersTypes/Both", typeof Root>>()
    const Plain = Game.EntityScope("ScopeTriggersTypes/Plain")
    expect(Plain).type.toBe<EntityScope.EntityScope<"ScopeTriggersTypes/Plain", typeof Root>>()
  })

  it("rejects an unknown state", () => {
    // @ts-expect-error Type '"Paused"' is not assignable
    Game.EntityScope("ScopeTriggersTypes/Typo", { despawnOnExit: [Flow, "Paused"] })
    // @ts-expect-error Type '"Paused"' is not assignable
    Game.EntityScope("ScopeTriggersTypes/TypoEnter", { despawnOnEnter: [Flow, "Paused"] })
  })

  it("rejects a machine of another game, naming the fix", () => {
    // @ts-expect-error ScopeTriggersTypes/OtherFlow is a state machine of another game: use a machine defined with this game's Game.StateMachine(...)
    Game.EntityScope("ScopeTriggersTypes/Foreign", { despawnOnExit: [OtherFlow, "Idle"] })
  })
})
