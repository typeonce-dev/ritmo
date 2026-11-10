---
"@typeonce/ritmo": patch
---

Two messages name the fix. A `[Descriptor, value]` tuple built outside the call (returned by a helper, pushed into an array) widened to an array and failed with `` `${string} is not a component of this game's schema` ``, though the component is in it; it now fails with `this entry widened to an array: write the [Descriptor, value] tuple in the call, add `as const` where it is built, or annotate it Command.Entry<typeof Descriptor>`. And `set` on an entity state declared with `transitions` names `data.x.setRaw(entity, raw)` for data from outside the simulation (a test, a level file), next to `transition`.

The `ritmo` skill's upgrade playbook lists what 0.23 changes without a compile error: `RenderSync` nodes made again on each new renderable value, a transient resource read before its writer after a load, `Clock.duration`'s half step, `FlowField` and `Collide2` moves, Ctrl/Cmd keys and non-standard gamepads, and the debug check of kept entities.
