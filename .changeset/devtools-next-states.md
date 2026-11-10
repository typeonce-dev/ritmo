---
"@typeonce/ritmo-devtools": patch
---

`Desync.compare` lists the queued next states that differ between two saves (`next state Game/Round`), now that saves hold them. `Fuzz`'s `Unreplayable` and the recorder's "no tick could be saved" error name queued commands as a cause next to a rejected `"~encode"`. No change for games.
