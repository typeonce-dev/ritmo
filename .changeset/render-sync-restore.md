---
"@typeonce/ritmo-render": patch
---

`RenderSync` stays correct across `runtime.restore`, which no longer reports the replaced world's entities as despawned: when its removal reads are lagged it destroys every node whose entity no longer matches, as before, and also the node of every entity added since, so an id the save gave to another entity gets a new node made from that entity's values. No change for games.
