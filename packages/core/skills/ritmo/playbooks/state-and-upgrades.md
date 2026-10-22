# State, saves, and upgrades

1. Give every new mutable value one home:
   - saved world state: a component or resource. It is saved by `runtime.snapshot()`, restored by `runtime.restore(...)`, and rolled back when a system fails.
   - unsaved runtime state: a transient component or resource, or the system's `local`. It is rebuilt after restore.
   - host state: a service or host code.
2. Decide what the value does on new game, restore, and dispose, and test it: take a snapshot, restore it, and assert the value.
3. Keep saved values plain data, decoded by their descriptor (the `Snapshot` and `Decode` module headers say how). A value that is not plain data (a `Map`, a `Set`, a class, a value a schema library transforms) gets an `encode` on its constructor (`Descriptor.Encoder`), so `runtime.snapshot()` saves a form its `decode` reads back.
4. When the saved shape changes, add a step to `Snapshot.migrations(...)` so older saves still load.
5. To upgrade Ritmo, read each package's `CHANGELOG.md` from the installed version up, apply each breaking entry's fix, and fix the remaining compile errors as their messages say.

**Done when** a snapshot taken before the change restores after it and the game's check passes.
