---
"@typeonce/ritmo-tools": minor
"@typeonce/ritmo": patch
---

`ritmo-tools fx`: judge effects at native size, and see when an approved effect has changed. Ideas from [PVFX Foundry](https://nerijs.itch.io/pvfx-foundry).

- **1× zoom** on the review page, to judge whether an effect reads at its native size.
- **Approval keeps what the person saw.** Approving an effect saves the draft in use, its fps, and a hash of each frame's final colors. When any of them later differ, `fx notes` and `fx render` list `changedSinceApproved` (`"frames 3-5 look different"`), and the page shows it with **Approve it as it is now**. The status stays approved: only the person changes it. A palette edit counts as a change. A review saved before this has no hashes, and reports nothing until the effect is approved again.
- The `ritmo-fx` skill adds a craft rule (each material dies its own way), the native-size question for the person, what to do with `changedSinceApproved`, and PVFX Foundry's Strict tier as a reference to look at.
- The example `explosion` draft `a` now sits on the floor, with thrown debris, embers, dust, and smoke that comes apart in clumps.

Breaking: `fx render` writes sprite sheets in rows of up to 8 frames, not one row, so a long effect stays within a device's texture limit. A game that reads each frame's rectangle from the JSON (`frames["hit 0"].frame`, as Pixi and Phaser do) needs no change. Replace code that computes a frame's place as `x = frame * width` with `x = (frame % 8) * width` and `y = Math.floor(frame / 8) * height`.
