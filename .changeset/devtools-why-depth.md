---
"@typeonce/ritmo-devtools": minor
---

**`why` follows the reads behind a value.** `session.why(entity, Component, { depth })` and `session.whyResource(Resource, { depth })` indent, under each change, what the writing system declared it reads and the latest traced fact that could have produced the value it saw: an event's sends since the system's previous run and their sender, the latest change of a component of the same entity (read in the query that wrote it), of a resource, or of a machine. Each `depth` step goes one system further back; `depth: 1`, the default, prints exactly what it printed before.

```ts
session.why(12, Health, { depth: 3 })
// f181 update  Game/ApplyDamage  write e12 Game/Health 70 -> 40
//   read Game/Damage [{amount:30}] (declared), emitted by Game/Hitscan at f181
//     read resource Game/Aim {target:12} (declared), written by Game/AimAtNewest at f180
```

- The trace records writes, not reads, so every such line ends in `(declared)`: a possible cause, not an observed read. A query over other entities prints only how many entities match it now (`read Game/Position of 14 matching entities now (declared; the trace does not say which it read)`).
- A system already in the chain prints `(cycle: not followed)`. `limit` also caps the reads under each line.
- `Session.WhyOptions` is the options type. `Format.Line` gains `depth` (0 for every journal line), `Format.LineKind` gains `read`, and `Format.line` prints a line with `depth` above 0 as its text, indented.
