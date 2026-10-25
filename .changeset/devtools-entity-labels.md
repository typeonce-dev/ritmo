---
"@typeonce/ritmo-devtools": minor
---

**Entity labels in devtools output.** `Session.make(runtime, { ..., labels: Labels })` takes a `Game.Inspector` returning a `ReadonlyMap<number, string>` (entity id to label), and every entity in the session's text prints as `player e12` instead of `e12`: journal and `why` lines, `dump`, report warnings, and invariant messages (write entities as `e${id}` in the message). Labels are evaluated after every frame of a `run`, so a line shows the label its entity had at the end of that frame, and a despawned entity keeps its last label. They run only in the debug session: the runtime and production builds do not change.

```ts
const Labels = Game.Inspector("labels", {
  queries: { players: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Player] }) }
}, ({ queries }) => new Map(queries.players.each().map((match) => [match.entity.id, "player"] as const)))
const session = Session.make(runtime, { hostClock, schedules: { update }, labels: Labels })
session.why(12, Position) // "player e12 Game/Position is now {x:4}; ..."
```

- An inspector returning anything else does not compile (`labels must return a ReadonlyMap<number, string> from entity id to label`); one reading a resource, service, or machine the runtime does not provide names it under `__fixLabelsRequirements__`, like invariants.
- `Replay.session(make, file, { labels })` and `Determinism.check(make, { ..., labels })` take the same inspector. A determinism difference inside an entity now carries `entity` (its id) and `label`.
- `Desync.compare(mine, theirs, { labels: runtime.inspect(Labels) })` names entities with the labels it is given. `Difference` gains `entity`.
- `Format.entity(id, labels)` is the one way devtools prints an entity; `Format.lines` and `Format.dump` take labels, and `Format.Line` gains `label`.
- A `run` whose labels inspector throws stops with `reason: "labels-threw"`.
- **Breaking: `Desync.compare` text prints entities as `e12` (`player e12` with labels), not `entity 12`.** `Difference.path` is unchanged; match on it, or on the new `entity`, instead of the text.
- **Breaking: `Determinism.check`'s factory returns the whole debug runtime** (`inspect`, `services`, `resourceValues`, `machineValues` as well as `debug` and `tryTick`), so `labels` is checked against its provisions. Return the `Game.Runtime.make(...).value` itself rather than an object picking `debug` and `tryTick`.
- **Breaking: `Session.Stop` has a new `labels-threw` reason.** An exhaustive `switch` on `stop.reason` adds the case.
