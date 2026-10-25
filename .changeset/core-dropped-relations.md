---
"@typeonce/ritmo": minor
"@typeonce/ritmo-devtools": minor
---

**A stream of the relation edges a target's despawn dropped.** When the target of a `Descriptor.Relation` despawns, the runtime removes every edge to it. A system now reads those edges once, with the same rules as `readRelationFailures`: each reader sees what was dropped since its own previous run, a reader gated by `when` drops what was published meanwhile, one under `pauseWhen` reads it later, a reader that fell behind by more than `Runtime.streamCapacity` records sees `lagged() === true`, and checkpoints rewind it.

```ts
const DropTargets = Game.System("Game/DropTargets", {
  droppedRelations: { lost: Game.System.readDroppedRelations(Targeting) },
  commands: Game.System.commands(Game.System.inserts(Idle))
}, ({ droppedRelations, commands }) => {
  for (const { source } of droppedRelations.lost.all()) commands.insert(source, [Idle, {}])
})
```

- Records are `Relation.Relation.Dropped`: `{ relation, source, target }` as entity ids. Only a target's despawn records an edge: `commands.unrelate`, relating the source elsewhere, and the source's own despawn record nothing. A `Descriptor.Hierarchy` records nothing, since its children despawn with their parent.
- Inspectors can read `droppedRelations` too.
- Debug traces carry a `relationDropped` effect on the despawn that dropped the edge, and devtools journals it as `Game/Targeting from e7 to e12 dropped: e12 despawned`. `describe()` lists a system's `droppedRelations` (`reads dropped relations: ...` in devtools), and `streams()` reports the `droppedRelation` streams.
- **Breaking for code that switches over debug types:** `Debug.Effect` has a new `relationDropped` kind, `Debug.StreamStatus["kind"]` and `Debug.MissedRead["kind"]` have a new `droppedRelation` kind, and `Debug.SystemDescription` has a new `droppedRelations` field. Add the case to an exhaustive `switch`, and the field to a hand-built `SystemDescription`.
