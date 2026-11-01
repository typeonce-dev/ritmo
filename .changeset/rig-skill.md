---
"@typeonce/ritmo": patch
---

A new skill, `skills/ritmo-rig`, for characters animated on a skeleton with `ritmo-tools rig`: when a rig fits (side-view characters made of parts, not small pixel sprites or the hand-drawn look), the authoring order from references and key poses to checks and contact sheets, how to act on each kind of note the person leaves on the review page, and how the game plays the bake (the sidecar decoded with its own Standard Schema, the clip and its start step as simulation state, the frame from `Clock`). `SETUP.md` links it next to the others:

```sh
ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-rig .agents/skills/ritmo-rig
```

The `ritmo` skill's UI and rendering playbook says when a baked clip's timing is simulation state rather than render state.
