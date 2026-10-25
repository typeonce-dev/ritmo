---
"@typeonce/ritmo": minor
"@typeonce/ritmo-netcode": minor
---

**A library that keeps its own world (Rapier, Box2D) can run inside a rewound schedule: `Checkpoint.rewindable`.** `runtime.checkpoint(simulate)` refused any service that is not a `snapshot()` source or plain data, since a rewind would call it again for every tick run again. A rewindable service gives a typed `save` and `restore`: every checkpoint keeps its `save` output (freed when the checkpoint is released), and `runtime.rewind` restores it and makes the result `current`.

```ts
const physics = Checkpoint.rewindable(world, {
  save: (world) => world.takeSnapshot(),
  restore: (bytes) => {
    const restored = RAPIER.World.restoreSnapshot(bytes)
    return restored === undefined ? Result.failure({ _tag: "CorruptSnapshot" as const }) : Result.success(restored)
  }
})
const Physics = Descriptor.Service<typeof physics>()("Game/Physics")
// Systems read `services.physics.current` each run; `runtime.checkpoint(simulate)` compiles.
```

- Cost: one `save` per checkpoint for each rewindable service the runtime was given, one `restore` per rewind. A runtime without one pays nothing.
- A failing `restore` fails the rewind with the new `RewindError` member `RestoreFailed { service, error }`, changing nothing. `runtime.rewind` types it by each service's name and `restore` error; a runtime without rewindable services never returns it. `RewindError` takes the failures as a parameter (`RewindError<never>` for none); bare `RewindError` covers every runtime. Netcode reports it as `CheckpointLost`.
- Not in saves or checksums: `runtime.snapshot()` does not include a rewindable service, `runtime.restore(save)` (and a netcode resync) leaves it as it is, and `runtime.checksum()` does not cover it. Mirror what gameplay reads from the library into components.

**Breaking (types only):** bare `Checkpoint.RewindError` (and so `Netcode.CheckpointLost["error"]`) now includes `RestoreFailed`. An exhaustive `switch` on its `_tag` adds the case; one over `runtime.rewind(...)`'s own result needs nothing for a runtime without rewindable services:

```diff
  switch (error._tag) {
    case "OtherRuntime": ...
    case "Released": ...
+   case "RestoreFailed": console.error(error.service, error.error); break
  }
```
