---
"@typeonce/ritmo": patch
---

Relating many entities to one target, and despawning a target many entities relate to, no longer slow down with the square of their number. Each `relate` searched the target's list for the source, and each source a despawn let go searched that list and remade it without itself. On one machine, despawning a parent with 10,000 children took 397 ms and now takes 10 ms; with 200,000 children it took 124 s and now takes 0.13 s. Relating 200,000 children to one parent took 4.9 s and now takes under 0.7 s.

Nothing a game reads changes: children keep their order, a child related to its parent again is still listed once, and a rewind puts the lists back as they were.
