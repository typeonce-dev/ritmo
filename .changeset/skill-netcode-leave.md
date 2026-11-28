---
"@typeonce/ritmo": patch
---

The `ritmo` skill's netcode playbook: a page that quits a match calls `session.leave()`, and one socket for a lobby and its match uses `WebSocketNetworkLink.make(socket, { prefix })`.
