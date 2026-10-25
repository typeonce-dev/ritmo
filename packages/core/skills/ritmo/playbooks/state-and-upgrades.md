# State, saves, and upgrades

**Goal:** every new value has one home and a tested fate on restore, and saves from before the change still load.

**Principles:** each piece of state has an owner and a lifetime; make impossible states unrepresentable.

1. Give every new mutable value one home:
   - saved world state: a constructed component or resource, saved by snapshots and rolled back when a system fails.
   - unsaved runtime state: a transient component or resource, or a system's `local`, rebuilt after restore. A rewind puts transient values back but not `local`, so a rewound schedule keeps no `local`.
   - host state: a service or host code.
   A value with a mode, or fields used by only one kind, is states, not a flat record.
2. Give every saved value a schema from the game's one schema library: [`../references/schemas.md`](../references/schemas.md) (with [`zod.md`](../references/zod.md) or [`effect.md`](../references/effect.md) for those libraries).
3. When the saved shape changes, add a step to `Snapshot.migrations(...)` so older saves still load.
4. To upgrade Ritmo, read each package's `CHANGELOG.md` from the installed version up, apply each breaking entry's fix, then fix the remaining compile errors as their messages say.
   Compile errors find most breaks. These still compile, so check each one the upgrade crosses:
   - 0.11: keyboard and pointer snapshots group their fields (`{ actions, vectors, used, ... }`). Code that walks a snapshot, like `Object.values(snapshot)`, now walks the groups: read `snapshot.actions`, or `snapshot.used` for "the player touched this device".
   - 0.13: `runtime.snapshot()` returns a `Result` (and `runtime.checksum()`, new in 0.14, does too). A call site typed `unknown` or `any` (a save function, a log) passes the `Result` itself: check `.ok` and pass `.value`.
   - 0.13: `dump().machines[name].current` is the machine's value, not its state name: compare `.current._tag`.
   - 0.13: saves of snapshot format 2 are rejected before migrations run; the `Snapshot.version` JSDoc says how to rewrite one.
   - 0.15: the devtools monitor and its "Save replay" button are gone: bind `recorder.save(reason)` to a key in the host.
   - Any version: a new lint rule is off until `.oxlintrc.json` lists it. Compare the config with the `@typeonce/oxlint-plugin-ritmo` README after every upgrade.

**Check:** a test takes a snapshot, round-trips it through `JSON.stringify` and `JSON.parse`, restores it, and asserts each new value; a snapshot taken before the change restores after it; the game's check passes.
