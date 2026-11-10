---
"@typeonce/ritmo": patch
---

The `ritmo` skill's netcode playbook says that a reloaded page ends the match (every peer ends with `Disconnected` `reason: "restarted"`, so `onFailure` offers a new match), that a HUD draws who everyone waits for from `status().waiting`, and that the rollback check looks for rollbacks on the peer ahead (the one behind may always have the input in time).
