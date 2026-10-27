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
   **Size** makes the picture smaller than one pixel per cell (a width, or
   ½, ⅓, ¼): each new pixel merges a block. **Keep outlines** lets a dark
   line through a block win over its most common color, so one-pixel
   outlines survive; a lone dark pixel does not.
2. **Palette.** Pick a preset (Game Boy, PICO-8, Sweetie 16, DawnBringer
   16/32, Endesga 32, NES, AAP-64), import a `.hex` or `.gpl` file, paste hex
   colors, or fetch a palette from Lospec by name. Click a swatch to edit it.
   **Keep the picture's colors** turns the palette off, so each pixel keeps
   its own color. To build a palette from the picture, **Propose colors**:
   **Dominant** (the most used colors, near-duplicates merged), **Balanced**
   (k-means), or **Distinct** (as different as possible, keeps small
   accents). Each proposal shows its share of the picture; **Colors kept**
   keeps the most used ones, and clicking a proposal adds or removes it.
   Locked swatches always stay. The background is left out when it is removed.
   **Lost colors** lists the details the palette has no match for: pixels
   whose own color is far from the color they got (a small saturated accent
   turned dull, a dark grey turned black, a grey turned skin), grouped by
   color with how many pixels each. Point at a row to see its pixels;
   **Keep** adds the color, locked, and every pixel nearest to it gets it
   back. **Lost when off by** sets how far counts as lost. To keep any other
   color, choose **Pick** above the picture and click it, on either side.
3. **Matching.** Each cell is read from its middle (**Read the middle**: less
   ignores blurred edges, more helps tiny cells). Every pixel read votes for
   its nearest palette color, and the most votes win, so no in-between color
   is ever made up. "Nearest" is measured in OKLab (default) or CIEDE2000.
   Ordered dithering is optional.
   **Clean up specks** merges the small groups of one color that an image
   generator's noise leaves (up to 1, 2, or 3 pixels; diagonal neighbours
   count, so one-pixel outlines are never specks). A speck takes the color it
   touches most, but only when there is doubt it is real: its own cells voted
   nearly as much for that color, or the two colors are close anyway.
   **Strength** sets how much doubt is enough: low merges only coin flips,
   100% merges every speck. Locked colors are never cleaned, cleaned pixels
   are outlined in yellow, and painting over one with **Restore** brings
   that speck back.
4. **Background.** **Remove the background** makes it transparent. The
   colors covering most of the border are the background (one, or the two
   tones of a fake checkerboard an image generator painted in); it is flooded
   inward from the border and stops at the outline. **Tolerance** sets how
   close a color must be; **Also enclosed areas** removes background-colored
   gaps the border cannot reach (and same-colored highlights); **Remove
   specks** clears groups of up to 3 pixels left alone in the background.
   To edit by hand, pick **Erase** or **Restore** above the picture (instead
   of **Move**) and paint on the fixed picture, with a **Pixel** or **Area**
   (the whole connected area of one color) brush. Hand edits work with or
   without removing the background, and are dropped when the picture's size
   changes.
5. **Compare.** **Source**, **Compare** (a split you can drag), and **Fixed**
   views. Zoom with the wheel, a pinch, or the buttons; drag to pan; double-click
   to fit.
6. **Export.** PNG at 1x (the true pixel art) or any whole scale; SVG in pixel
   units with crisp edges (it stays sharp at any size; same-colored areas are
   merged into rectangles); a JSON map (size, palette, one row of palette
   indices per pixel row, -1 for transparent); the palette as `.hex` or `.gpl`.

**Undo** and **Redo** (above the picture, or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z
or Ctrl+Y) cover every setting: the grid, the palette, the background,
strokes, and the size. A slider drag, a typed number, or a stroke is one
step. Opening another picture starts the history over.

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
  drifting lines), `fix.ts` (reading cells, quantizing, dithering),
  `cleanup.ts` (specks), `palette.ts` (presets, files, extraction, proposals), `reduce.ts`
  (fewer, bigger pixels), `background.ts` (background removal), `lost.ts`
  (colors the palette lost), `export.ts` (PNG pixels,
  SVG, JSON), `demo.ts` (the fake AI picture generator).
- `src/ui/`: the page (plain DOM and a canvas, no framework).
