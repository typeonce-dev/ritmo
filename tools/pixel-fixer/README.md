# Pixel fixer

Turns blurry or AI-made pixel art into true pixel art. Image generators draw
"pixel art" as a large picture whose fake pixels are uneven, blurred, and
slightly off-color. The fixer finds the hidden pixel grid, gives each cell
one color from a palette you choose, and exports the result at its true size
(or any whole scale), as PNG, SVG, or a JSON map.

It runs entirely in the browser. Pictures never leave the device.

This is a standalone tool in the Ritmo repository, not a published package.

## Run it

```sh
pnpm install
pnpm --dir tools/pixel-fixer dev            # http://localhost:5173
pnpm --dir tools/pixel-fixer dev --host     # also reachable from a phone on the same network
pnpm --dir tools/pixel-fixer build          # static site in tools/pixel-fixer/dist
```

Open a picture (button, drag and drop, or paste), or press **Try the demo**
for a fake AI picture of a mushroom.

## How to use it

1. **Grid.** The grid is detected when a picture opens. The note under
   **Auto-detect** gives the cell size, the output size, and a confidence. Below
   about 50%, check the pink grid lines against the picture. Fix it by typing
   the cell size and offset (fractions are fine: AI pictures are often scaled
   by 7.6 or 23.3), or drag a single line on the picture. Lines moved by hand
   turn yellow. **Follow drifting lines** moves every line onto its nearest
   edge, for pictures whose cells grow or shrink across the picture.
2. **Palette.** Pick a preset (Game Boy, PICO-8, Sweetie 16, DawnBringer
   16/32, Endesga 32, NES, AAP-64), extract colors from the picture (locked
   colors stay), import a `.hex` or `.gpl` file, paste hex colors, or fetch a
   palette from Lospec by name. Click a swatch to edit it. **Keep the picture's
   colors** turns the palette off, so each pixel keeps its own color.
3. **Matching.** Each cell is read from its middle (**Read the middle**: less
   ignores blurred edges, more helps tiny cells). Every pixel read votes for
   its nearest palette color, and the most votes win, so no in-between color
   is ever made up. "Nearest" is measured in OKLab (default) or CIEDE2000.
   Ordered dithering and stray-pixel removal are optional.
4. **Compare.** **Source**, **Compare** (a split you can drag), and **Fixed**
   views. Zoom with the wheel, a pinch, or the buttons; drag to pan; double-click
   to fit.
5. **Export.** PNG at 1x (the true pixel art) or any whole scale; SVG in pixel
   units with crisp edges (it stays sharp at any size; same-colored areas are
   merged into rectangles); a JSON map (size, palette, one row of palette
   indices per pixel row, -1 for transparent); the palette as `.hex` or `.gpl`.

## How the grid is found

`src/core/grid.ts`. For each axis, the picture's edge profile (how sharply the
color changes across each column or row boundary) repeats at the cell size.
Its spectrum gives candidate sizes; each is refined to a few thousandths of a
pixel with its offset, then judged by how often the middle of its cells holds
an edge (the true size almost never; a wrong size often). Among the clean
candidates, the one whose lines are strongest wins: that rules out fractions
of the true size, which are as clean but have half their lines mid-cell.

## Limits

- Cells of about 3 source pixels or fewer that are also blurred across their
  whole width cannot be found reliably. Confidence is then low; set the cell
  size by hand.
- Details smaller than one cell are lost, and dithering in the source picture
  reads as noise.
- A palette that does not fit the picture gives banding. That is what the
  palette asked for; extracting a palette first, then editing it, helps.
- Fetching from Lospec depends on lospec.com allowing the request from the
  browser. If it fails, download the `.hex` file from lospec.com and import it.
- It fixes pixels and colors, not the drawing itself.

## Code

- `src/core/`: the headless core, tested in `test/` with fake AI pictures made
  from known sprites (`pnpm test` from the repository root runs them).
  `color.ts` (OKLab, CIELAB, CIEDE2000, nearest color), `grid.ts` (detection,
  drifting lines), `fix.ts` (reading cells, quantizing, dithering, stray
  pixels), `palette.ts` (presets, files, extraction), `export.ts` (PNG pixels,
  SVG, JSON), `demo.ts` (the fake AI picture generator).
- `src/ui/`: the page (plain DOM and a canvas, no framework).
