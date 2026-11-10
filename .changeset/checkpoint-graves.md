---
"@typeonce/ritmo": patch
---

A held checkpoint keeps only the events, removals, and despawns a rewind can bring back: those published before the newest held checkpoint was taken. A game that took one checkpoint and kept it (a level retry, an undo) kept every event batch and removal record published after it: about 160 MB after 2,000 ticks of one 10,000-number event, now about 0.5 MB. No API change.
