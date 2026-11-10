---
"@typeonce/ritmo-devtools": minor
---

A replay whose window starts from a save no longer reports a false divergence. Once a recording outlasts `keep` (or after `Replay.extract`), the file starts from a save of a later tick, and a save does not hold events in flight or what each `added()` / `changed()` reader had already seen, so an ordinary game replayed to other checksums and `play()` said `DIVERGED ...: the simulation is not deterministic, or the code changed since recording`. Neither was true. Such a replay now plays as before (stepping, `why`, invariants) and says `starts from a save at tick 14: checksums are not compared (a save does not hold events in flight or what each reader had already seen)`. A file that starts at tick 0, where the recorder started, is compared as before. `Verify.acrossEngines` and `ritmo-devtools verify` skip the recording's checkpoints for such a file in the same way and say so; they still compare the two Node runs and every engine.

Breaking: `play().data.diverged` is replaced by `play().data.checkpoints`, which is `{ _tag: "Compared", diverged }` or `{ _tag: "NotCompared", reason }`, so a test can tell "not compared" from "compared and equal":

```diff
- expect(played.data.diverged).toEqual([])
+ expect(played.data.checkpoints).toEqual({ _tag: "Compared", diverged: [] })
```

`Verify.Verified` has `recording: "matched" | "notCompared"`.
