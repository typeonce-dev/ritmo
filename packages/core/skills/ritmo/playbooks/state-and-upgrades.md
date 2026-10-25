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

**Check:** a test takes a snapshot, round-trips it through `JSON.stringify` and `JSON.parse`, restores it, and asserts each new value; a snapshot taken before the change restores after it; the game's check passes.
