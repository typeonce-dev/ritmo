import plugin from "@typeonce/oxlint-plugin-ritmo"
import { tester } from "./tester.ts"

const rule = plugin.rules["no-state-spread"]!

tester.run("no-state-spread", rule, {
  valid: [
    // A move writes the new state's fields.
    "data.contact.transition({ from: \"ground\", to: \"air\", data: { vy: 2, coyote: 0 } })",
    "const next = { _tag: \"air\", vy: body.vy, coyote: 0 }",
    // Spreading to change fields of the same state.
    "data.contact.update({ state: \"air\", data: (air) => ({ ...air, vy: air.vy - 1 }) })",
    "machines.mode.update({ state: \"Talking\", data: (talking) => ({ ...talking, typed: talking.typed + 1 }) })",
    "if (air._tag === \"air\") data.contact.set(entity, { ...air, vy: air.vy - 1 })",
    // The tag written before the spread names the state the spread's fields belong to.
    "const value = { _tag: to, ...data }",
    "if (data._tag === \"air\") emit({ _tag: \"Landed\", ...data })",
    // Keeping the spread value's own tag.
    "if (value._tag === \"air\") copy = { ...value, extra: 1, _tag: value._tag }",
    // Other keys, and computed keys.
    "if (base._tag === \"air\") node = { ...base, tag: \"air\" }",
    "if (base._tag === \"air\") node = { ...base, [key]: \"air\" }",
    // Plain values tagged for an event: nothing says they are a state.
    "const position = data.position.get(entity)\nevents.explosion.emit({ ...position, _tag: \"Explosion\" })",
    "events.hit.emit(Object.assign({}, position, { _tag: \"Hit\" }))",
    "const popped = { ...body, _tag: \"air\", vy: 2 }",
    // A rest without the tag, written out with no tag.
    "const { _tag, ...rest } = ground\nconst copy = { ...rest, kind: _tag }",
    // A rest given back a tag that may be its own (core's state codec, internal/states.ts).
    "const tag = raw[\"_tag\"]\nconst { _tag, ...data } = raw\nreturn { _tag: tag, ...data }",
    // A slot read is a state's only when the same function moves that slot.
    "const contact = data.contact.get(entity)\nnext = { ...contact, _tag: \"air\" }",
    "Game.System(\"Game/A\", spec, ({ data }) => { data.contact.transition(entity, { from: \"ground\", to: \"air\", data: { vy: 0, coyote: 0 } }) })\nGame.System(\"Game/B\", spec, ({ data }) => { next = { ...data.contact.get(entity), _tag: \"air\" } })"
  ],
  invalid: [
    {
      // shape-brawl src/sim/fighter.ts: the breaker kept `grounded` while moving the body into the air.
      code: "if (body._tag === \"ground\") {\n  const popped = { ...body, _tag: \"air\", vy: 2 }\n}",
      errors: [{ messageId: "spread", data: { spread: "body" } }]
    },
    {
      code: "switch (state._tag) {\n  case \"idle\":\n    return { ...state, _tag: \"hurt\", stun: 20 }\n}",
      errors: [{ messageId: "spread", data: { spread: "state" } }]
    },
    {
      code: "if (current.action._tag === \"windup\") {\n  const value = { ...current.action, \"_tag\": next }\n}",
      errors: [{ messageId: "spread", data: { spread: "current.action" } }]
    },
    {
      code: "const settle = (previous) => {\n  const { _tag } = previous\n  return _tag === \"air\" ? { _tag: \"ground\", ...previous, _tag: \"air\" } : previous\n}",
      errors: [{ messageId: "spread", data: { spread: "previous" } }]
    },
    {
      // A state machine's value: the conversation's fields would survive into Exploring.
      code: "const talking = machines.mode.get()\nnextMachines.mode.set({ ...talking, _tag: \"Exploring\" })",
      errors: [{ messageId: "spread", data: { spread: "talking" } }]
    },
    {
      code: "nextMachines.mode.set({ ...ctx.machines.mode.get(), _tag: \"Exploring\" })",
      errors: [{ messageId: "spread", data: { spread: "ctx.machines.mode.get()" } }]
    },
    {
      code: "const queued = nextMachines.mode.getPending()\nif (queued !== undefined) nextMachines.mode.set({ ...queued, _tag: \"Exploring\" })",
      errors: [{ messageId: "spread", data: { spread: "queued" } }]
    },
    {
      // An entity state's slot: the same function moves it with transition.
      code: "const contact = data.contact.get(entity)\nif (jump) data.contact.set(entity, { ...contact, _tag: \"air\", vy: 2, coyote: 0 })\nelse data.contact.transition(entity, { from: \"air\", to: \"ground\", data: { platform: null } })",
      errors: [{ messageId: "spread", data: { spread: "contact" } }]
    },
    {
      code: "data.contact.update(entity, { state: \"air\", data: (air) => ({ ...air, vy: 0 }) })\nreset(entity, { ...data.contact.get(entity), _tag: \"ground\", platform: null })",
      errors: [{ messageId: "spread", data: { spread: "data.contact.get(entity)" } }]
    },
    // The same re-tag written other ways.
    {
      code: "if (ground._tag === \"ground\") next = Object.assign({}, ground, { _tag: \"air\" })",
      errors: [{ messageId: "spread", data: { spread: "ground" } }]
    },
    {
      code: "if (ground._tag === \"ground\") next = { ...ground, ...{ _tag: \"air\" } }",
      errors: [{ messageId: "spread", data: { spread: "ground" } }]
    },
    {
      code: "const { _tag, ...rest } = ground\nnext = { _tag: \"air\", ...rest }",
      errors: [{ messageId: "spread", data: { spread: "rest" } }]
    }
  ]
})
