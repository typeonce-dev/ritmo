---
"@typeonce/ritmo-tools": minor
"@typeonce/ritmo": minor
---

`ritmo-tools pixel` checks the craft of sprites and the motion of animations, and draws art as the player will see it.

- `pixel lint`, `check`, `fix`, `render`, and `sheet` warn on **jaggies**, **doubles**, and **holes**, the craft rules `fx check` already measured on effects, each with the pixels where it happens. On an animation sheet they also warn on **flicker** (lone pixels that blink for one frame), **area** (the body changing size), **skate** (the foot on the ground moving by uneven steps), and **seam** (a loop that jumps back to its start). The report's `animation.animations[].motion` gives the numbers, including `ground.pixelsPerSecond`, the speed the game moves the sprite at so the planted foot stays still. `pixel lint` reads a written sprite sheet's `.json` too.
- `pixel look <files...>` writes one picture: every piece at display size on the game's backdrop beside its player, then each frame up close with every warning's pixels ringed in magenta.
- `pixel.config.json` takes `scale`, `backdrops` (colors or tile PNGs by name), and `standIn` for `look`, and `accept`: warnings judged deliberate, per file, each with why (`{"art/torch.png": {"doubles": "the flame's tip is two pixels on purpose"}}`). Reports list them under `accepted`; errors cannot be accepted.
- The `ritmo-pixel-art` skill works in rounds: a brief in the design notes before the first pixel, then check, look, motion read as numbers, and the person's notes; it adds a table of what a person sees and the usual fix.
