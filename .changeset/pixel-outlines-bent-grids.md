---
"@typeonce/ritmo-tools": minor
---

`ritmo-tools pixel`: one-pixel outlines, bent grids, and a shrink that keeps strokes whole, after [ToPixel](https://github.com/daisuqe/ToPixel).

- **Outlines** (`outlines` in a recipe, `--outlines auto|on|off`, **Outlines** on the page; `"auto"` by default): when the picture's dark strokes are about one cell wide, a stroke a grid line split between two pixels goes back to one, never breaking the outline or a corner, and followed lines keep off dark strokes. The report's `grid.outlines` says whether it ran.
- **Follow lines** is now a choice: `"off"`, `"straight"` (every line placed at once, each on a strong edge with every gap near the cell size, instead of one after another), or `"bend"` (lines placed in each row and column of cells on their own, for a grid the generator warped). The page draws bent lines bent.
- **Keep outlines** when shrinking (`--shrink-to`, **Size**) carries outlines over as strokes: thinned back to one pixel without breaking, one-pixel steps turned into diagonals. A one-pixel ring shrunk from 16 to 11 pixels stays whole, where it used to lose its sides.

Breaking: a recipe's `follow` is `"off"`, `"straight"`, or `"bend"`, no longer `true` or `false`, and `--follow` takes one of them. Replace `"follow": true` with `"follow": "straight"` (`--follow straight`), and `"follow": false` with `"follow": "off"` (or leave it out).
