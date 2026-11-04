---
"@typeonce/ritmo-tools": minor
"@typeonce/ritmo": patch
---

`ritmo-tools pixel`: hold a frame, see an animation as a still, and check a tile's edges. Ideas from [Pixelorama](https://github.com/Orama-Interactive/Pixelorama).

- **Holds.** `pixel sheet --animations "attack=5,6x3,7,8"` shows frame 6 for 3 beats, a beat being one frame at `--fps`. The JSON's `duration`, the GIF, the recipe (`sheet.frames[i].beats`), and the page's player all follow it, the page sets it on the chosen frame, and the report lists each frame's time in `durations`.
- **Onion pictures.** `pixel sheet` writes `<name>.<animation>.onion.png`: a panel per step of playback, each frame over the one before in red and the one after in blue, so an agent that cannot watch an animation can see a jump, a drift, or a change of size.
- **Tile seams.** `pixel lint tile.png --tile both` (or `x`, `y`) warns of a `seam` when a tile's edges do not meet, and `pixel preview tile.png --tile both` writes it repeated.
- The `ritmo-pixel-art` skill says when to use each, and that a game plays each frame for its `duration`.

Breaking: the sprite sheet JSON of `pixel sheet` and `fx render` no longer has `meta.fps`, since one rate would lose a frame's hold. Replace `meta.fps[name]` with each frame's time, `frames["<name> 0"].duration`, in milliseconds. With Pixi, give `AnimatedSprite` `{ texture, time }` objects built from those durations.
