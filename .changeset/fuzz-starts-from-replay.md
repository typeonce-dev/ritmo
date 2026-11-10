---
"@typeonce/ritmo-devtools": patch
---

`Fuzz.run` finds only bugs its replay reproduces. A run used to tick `setup` and carry on with the live world, while its replay starts from a save of that world, so a bug that needed what setup left in flight (an event emitted in setup and read on the first frame) came back with `reproduces: false` and a replay that passed. Each run now loads its own save after `setup`, before the first fuzzed frame, so the run and its replay start from the same world. A game whose setup emits events for the first frame no longer has them in fuzz runs, as it never had them in the replays.
