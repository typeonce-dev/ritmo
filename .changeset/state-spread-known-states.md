---
"@typeonce/oxlint-plugin-ritmo": minor
---

`ritmo/no-state-spread` reports a `_tag` set over a spread only when the file shows the spread value is a state, and reads more ways of writing the same re-tag.

A spread value is a state when it is read from a state machine (`machines.x.get()`, `nextMachines.x.getPending()`) or from an entity state's slot the same function moves (`data.contact.get(entity)` next to `data.contact.transition(...)` or `data.contact.update(entity, { state, data })`), directly or through the variable holding it, or when the same function reads its `_tag` (`if (body._tag === "ground")`, `switch (state._tag)`, `const { _tag } = previous`).

Newly reported, with the message saying to move with `data.x.transition(entity, { from, to, data })` or `nextMachines.x.transition({ from, to, data })`, or to write the new state's fields out:

- `Object.assign({}, ground, { _tag: "air" })`;
- `{ ...ground, ...{ _tag: "air" } }`;
- `const { _tag, ...rest } = ground`, then `{ _tag: "air", ...rest }`.

No longer reported: a spread value nothing in the file shows to be a state, such as a plain value tagged for an event (`events.explosion.emit({ ...position, _tag: "Explosion" })`). The compiler already rejects an `update` callback that changes `_tag` and `set` on a state declared with `transitions`.
