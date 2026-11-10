---
"@typeonce/ritmo-math": patch
---

`Vec2.moveToward` and `Vec2.clampLength` count a limit below 0 as 0, as `Scalar.moveToward` and `Angle.turnToward` already did. A speed that went negative (a slow effect minus friction) moved the point away from its target, and a negative cap flipped the vector; now `moveToward` returns `current` unchanged and `clampLength` the zero vector. A `NaN` limit counts as 0 too, as in `Scalar.moveToward`.

`FlowField.distance` gives a distance wherever `way` gives a direction. From a blocked cell (a body pressed against a wall or into a corner) it was `undefined` even where `way` led it out, so a chaser ranking targets by distance skipped it. It is now the distance out along the steps `way` takes: to the open cells it heads for, plus their distance. It is `undefined` exactly where `way` is, except where the body is already there. Every open cell's distance is unchanged.

`FlowField`'s docs say which wall sizes the field can step through: a cell is blocked by its center alone, so a wall `width` by `height` can fall between open cells exactly when `hypot(max(0, cellSize - width), max(0, cellSize - height)) > 2 * clearance`. No step crosses a wall at least `cellSize - clearance * √2` thick both ways, and none crosses any wall when `cellSize <= clearance * √2`; with thinner walls, use smaller cells or a larger clearance. Behaviour is unchanged.
