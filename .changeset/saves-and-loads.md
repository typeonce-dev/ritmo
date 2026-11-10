---
"@typeonce/ritmo": minor
---

A load leaves nothing of the world it replaced, and a save holds the work still queued, so the same save gives the same world in every runtime that loads it (every peer of a netcode match).

Breaking:

- `runtime.restore(save)` gives every transient resource, and every resource and machine the save does not hold, the value the runtime was made with (`Game.Runtime.make({ resources, machines })`). Each used to keep its live value, so a load kept state of the replaced world: two peers that resync kept their own transient value and desynced again, and a player in `Over` who loaded a save from before that machine existed stayed in `Over`. A transient resource a capture system fills each tick (`InputCapture.system`) is filled again by its next run, so input needs nothing. The fix for any other transient resource, and for a resource the game added after its saves were written: set it again after a successful `restore` the way the game first set it, or give older saves the value with a `Snapshot.migration`.

- `runtime.restore(save)` publishes nothing about the world it replaced. It used to report every entity of that world as despawned and each of its components as removed, so a system reading `readDespawned()` or `readRemoved(X)` saw entities that were never in the save, and saw them on one peer and not the other (seat 0 sets its world up before the first save). Now every system and inspector that read removed or despawned records, events, transition events, or relation failures before the load finds none from before it, and its next read reports `lagged()`; a reader whose first run comes after the load is not lagged. Restored entities still show as added. A system that mirrors entities (a node or a cache per entity) rebuilds from queries when its read is lagged:

  ```ts
  if (despawned.entities.lagged()) rebuildFrom(queries.alive.each())
  ```

- `runtime.snapshot()` and `runtime.checksum()` fail with `{ _tag: "QueuedCommands", count }` while a command waits for a marker: a command is a function, which no save can hold, so the loaded world ran differently from the one that wrote it. End the schedule the save follows with its marker:

  ```diff
  -const update = Game.Schedule(Input, Move, Spawn)
  +const update = Game.Schedule(Input, Move, Spawn, Game.Schedule.applyDeferred())
  ```

- `Snapshot.WorldSnapshot` has a `nextStates` field: the next states queued for the following `applyStateTransitions`, by machine name (`{ state, ifChanged, from? }`, a `Snapshot.NextStateSnapshot`). `snapshot()` writes it, `checksum()` covers it, and `restore` validates it (`InvalidNextState`, or `InactiveSubState` for a queued sub-state whose parent is elsewhere) and queues it again, so the next marker applies it as in the runtime that wrote the save. A save written before has none and loads with nothing queued, so `Snapshot.version` stays 3. Code that builds a `WorldSnapshot` by hand (a test fixture, a migration that returns a new object) adds the field:

  ```diff
  -const save: Snapshot.WorldSnapshot = { version: 3, gameVersion: 0, nextEntity: 1, entities: [], relations: {}, resources: {}, machines: {}, scopes: {} }
  +const save: Snapshot.WorldSnapshot = { version: 3, gameVersion: 0, nextEntity: 1, entities: [], relations: {}, resources: {}, machines: {}, nextStates: {}, scopes: {} }
  ```

  A world with nothing queued keeps the checksum it had, so replays recorded before still verify. `Snapshot.SnapshotError` adds `QueuedCommands` and `UnencodableNextState`, and `Snapshot.RestoreError` adds `InvalidNextState`: an exhaustive `switch` on either adds the cases.

Fixed: `runtime.checksum()` hashes what a JSON save writes. An object key whose value is `undefined` is skipped and `undefined` in an array hashes as `null`, so a world read back from its JSON save has the checksum of the world that wrote it; a schema with optional fields that accepted `{ a: 1, b: undefined }` made a peer that joined from a save report a desync against the host forever.

The `ritmo` skill's state playbook lists both breaking changes for an upgrade.
