---
"@typeonce/ritmo-tools": minor
---

`ritmo-tools pixel`: find the grid of a small sprite on a large canvas, and never call an upscale pixel art at its own size. Measured with the benchmark of [xprite-pixelate](https://github.com/rhinoc/xprite-pixelate) (MIT) and [pixel-bench](https://github.com/Retro-Diffusion/pixel-bench) (MIT).

- **The grid is read on the subject.** `pixel check`, `pixel fix`, and the page find the cell size on the picture's visible pixels, or, on an opaque picture whose border is one color (an image generator's off-white page), on the pixels away from that color, then place the grid on the whole picture. A sprite filling a fifth of its canvas came out with cells several times too large; on the AI benchmark, exact sizes rise from 65% to 76%, and from 24% to 99% for a small sprite on a clear canvas.
- **An upscale is not pixel art at its own size.** A picture whose neighbouring pixels rarely change color and that has more than 32 colors is judged as a fix, so a grid that cannot be found reports `needs-person` ("Unsure of the grid") where it reported `clean` or `fixable` at the picture's full size. Flat pixel art of a few colors (a parallax layer) is still pixel art at its own size.
