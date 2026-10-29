---
"@typeonce/ritmo-tools": patch
---

The sound lab's and the music lab's review pages also run on the website, with an example kept in the tab: https://ritmo.typeonce.dev/tools/sound/ and https://ritmo.typeonce.dev/tools/music/. `ritmo-tools sound review` and `ritmo-tools music review` work as before.

`ritmo-tools` pins `@effect/platform-node-shared` to 4.0.6: a fresh install pulled 4.1.0, which no longer exports what `@effect/platform-node` 4.0.6 imports, and the command failed to start.
