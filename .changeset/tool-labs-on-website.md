---
"@typeonce/ritmo-tools": patch
---

The sound lab's and the music lab's review pages also run on the website, with an example kept in the tab: https://ritmo.typeonce.dev/tools/sound/ and https://ritmo.typeonce.dev/tools/music/. `ritmo-tools sound review` and `ritmo-tools music review` work as before.

`ritmo-tools` starts again on a fresh install: it failed with `does not provide an export named 'NodeWS'` once Effect 4.1.0 was published, because `@effect/platform-node` 4.0.6 pulled `@effect/platform-node-shared` 4.1.0. The tools now use Effect 4.1.0 throughout, with `@effect/platform-node-shared` pinned to the same version.
