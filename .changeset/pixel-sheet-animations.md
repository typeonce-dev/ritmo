---
"@typeonce/ritmo-tools": minor
"@typeonce/ritmo": patch
---

`ritmo-tools pixel`: several animations on one sheet. Each row of frames is one animation by default (`animation-1`, ... in reading order; where two blocks sit side by side, a row across both is split where they meet). The page's **Animations** panel chooses which are exported (**In**/**Out**), plays, renames, and sets each one's speed and loop, and **Split** / **Join with next** regroup them. Each animation gets its own canvas. The sheet PNG holds every exported animation, each from a new row; its JSON names each one under `animations` and `frameTags`, frames are named `<animation> 0`, ..., and `meta.fps` is a map from animation to frames per second. `pixel sheet` writes a GIF per animation (`<name>.<animation>.gif`) and frames under `.frames/<animation>/`, lists the animations in its report (`animation.animations`), and takes `--animations "walk=1-4;explode=5-14"` and `--only walk,explode`.

Breaking, for recipes and code reading the sheet: `sheet.fps` and `sheet.loop` moved onto each animation (`sheet.animations[i].fps`, `.loop`). A recipe without `animations` still reads, as one animation of every frame at its `fps` and `loop`. The report's `animation.fps` and `animation.loop` are now per animation in `animation.animations`, and `output` is the size of the sheet written.

The `ritmo-pixel-art` skill says how to name and pick animations with `--animations` and `--only`.
