---
"@typeonce/ritmo-netcode": patch
---

`session.advance(...)` counts the ticks a rollback ran again in its result. The rollback made at the start of an advance was left out of `again` (and `ticks`), so a game reading the result saw `again: 0` while `status().again` grew.
