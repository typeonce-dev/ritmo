---
"@typeonce/ritmo-devtools": minor
---

Sessions and replays understand rewinds (rollback netcode, client prediction):

- `why`, `whyResource`, `journal`, and `system` show each `runtime.rewind` as a line between the frames it separates, under every filter: `f20   -  rewind to tick 81, undoing f13-f20`. A change whose `before` is not the previous line's `after` has the rewind above it; before, undone ticks read as real history. A filter's `limit` counts the other lines and keeps the rewinds between and after them. `report()` counts them (`Report.rewinds`) and lists the count in its first line. `Format.LineKind` has `"rewind"`, and `Format.rewind(event, undid)` renders one.
- `Replay.recorder` forgets the ticks a rewind undid, so a file recorded on a rollback peer holds each tick as it last ran and replays without diverging. It used to record every run of a tick as a new tick.

A `switch` over `Format.LineKind` that checks it is exhaustive needs a `case "rewind"`.
