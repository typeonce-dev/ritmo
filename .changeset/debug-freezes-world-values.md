---
"@typeonce/ritmo": minor
---

**Breaking (debug runtimes only): a runtime made with `debug` freezes every value it is handed, so mutating one afterwards throws where it mutates.** Values were stored by reference: an object passed to `Game.Command.spawn`, `commands.insert`, a cell's `set`/`update`, a resource write, `emit`, `runtime.send`, a next-state `set`, or `Game.Runtime.make` stayed connected to the code that made it. Mutating it later changed the world with no write, so `changed` readers missed it, and a `rewind` brought back the mutated value instead of the checkpointed one. A debug runtime now deep-freezes each value as it is queued or written, and the mutation throws a `TypeError`. Typed arrays are skipped, `Map` and `Set` contents stay writable, and runtimes without `debug` behave as before.

If your game's tests or devtools sessions now throw, build a new value instead of mutating the one you handed over:

```diff
-const body = { x: 1, trail: [] }
-commands.spawn(Game.Command.spawn([Body, body]))
-body.x += 1
+commands.spawn(Game.Command.spawn([Body, { x: 1, trail: [] }]))
+// later, in a system
+data.body.update((body) => ({ ...body, x: body.x + 1 }))
```

`Runtime.tick` now points to `FixedLoop.start` for ticking at a fixed rate from a frame loop. The `ritmo` skill now treats a variable a system closes over like a module variable: host input reaches systems through a resource, a sent event, or an input source service.
