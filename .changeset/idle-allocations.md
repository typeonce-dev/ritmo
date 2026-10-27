---
"@typeonce/ritmo": patch
"@typeonce/ritmo-browser": patch
---

Less garbage every frame, with no API change. A system run that queues no commands and writes no resource or machine now allocates nothing; before, it allocated about 400 bytes, because V8 allocates a new table on every `Map`/`Set` `clear()`, even of an empty one. A schedule of 100 small systems runs about 2.5× faster, and the top-down example game makes about 27% less garbage per frame. A frame that requests no state transition skips sorting the empty queue. `Keyboard`, `Gamepad`, and `Pointer` snapshots share one idle state object for every action not in use, as `Controls` already did.
