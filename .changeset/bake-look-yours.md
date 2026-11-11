---
"@typeonce/ritmo-tools": minor
---

`ritmo-tools pixel bake` leaves the look to you, not only the design. A part takes a ramp step for each way its surfaces face (`"steps": { "top": 2, "right": 1, "left": 0 }`) and a `line` where it meets a part behind it (`true` for the outline's color, `"step"` for one step darker, or a color). A `face` takes `rows`, a picture drawn flat that the bake lays on it and turns with the model. `"map": true` writes `<name>.map.json`, with each pixel's part, face, facing, depth, and place on its face, so a script can restyle the PNG. The camera can be given in a game's own terms, `{ "across": [1, -1, 0], "down": [0.5, 0.5, -1] }` for 2:1, in place of `yaw`, `elevation`, `scale`, and `heightScale`. The outline no longer breaks at a sharp tip such as a roof's eave: the lone-pixel cleanup used to remove an outline pixel that met the rest only at a corner.
