---
"@typeonce/ritmo-netcode": patch
---

A session enforces the sender's own limits on what it receives, so another peer cannot grow its memory without bound: an inputs message with more than 64 inputs, or a checksum longer than 16 characters, is malformed, and inputs or checksums for ticks further ahead than an honest peer can be (more than `2 * (maxRollback + inputDelay) + 64` ticks past this peer's last input, `adaptiveDelay.max` for an adaptive delay) are dropped. Both count in `status().dropped`. An honest match whose peers give the same `maxRollback` and delay drops nothing, through a resync and a seat that hides and returns; a peer given a larger `maxRollback` may see some inputs dropped until they are in reach, and sends them again.
