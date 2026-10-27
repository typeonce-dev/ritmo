# Pixel fixer

Turns blurry or AI-made pixel art into true pixel art. Image generators draw
"pixel art" as a large picture whose fake pixels are uneven, blurred, and
slightly off-color. The fixer finds the hidden pixel grid, gives each cell
one color from a palette you choose, and exports the result at its true size
(or any whole scale), as PNG, SVG, or a JSON map.

It comes in two parts that share one core: a web page for people tuning art
by hand (it runs entirely in the browser; pictures never leave the device),
and the `pixel` CLI for agents that check, fix, and make art on their own.
A recipe saved by one runs in the other.

This is a standalone tool in the Ritmo repository, not a published package.
The page wears Ritmo's brand (`brand/README.md`): its colors, its mark as the
logo, and its Tick orange only on what is active or selected. The palette
presets include Ritmo's own six colors.

## Run it

The page is part of the website, at https://ritmo.typeonce.dev/tools/pixel/
(`website/src/pages/tools/pixel/index.astro` mounts it). It is built and
deployed with the site, so locally it runs with the site too:

```sh
pnpm install
pnpm --dir website dev            # http://localhost:4321/tools/pixel/
pnpm --dir website dev --host     # also reachable from a phone on the same network
pnpm --dir website build          # the site, with the page at dist/tools/pixel/
```

Open a picture (**Open** in the top bar, drag and drop, or paste), or press
**Try the demo** for a fake AI picture of a mushroom. The same button opens a sprite source
(`.txt`) or a JSON map as pixel art at its own size, a recipe (applied to the
picture open), and a `pixel.config.json` (its rules, palette, and settings).

The page has three parts: the top bar (the file, the **Source**, **Compare**,
and **Fixed** views, undo and redo, **Open**, and **Export**), the picture
with its tools floating over it (**Move**, **Lines**, **Erase**, **Restore**, **Paint**, **Pick**,
and zoom), and the settings on the right, in sections that fold away and
stay folded. Each section's **ⓘ** button explains it. Keys: V, L, E, R, B, and I
pick a tool, G shows or hides the grid, and Shift+1 fits the picture. On a
phone the settings sit under the picture.

```sh
pnpm --dir tools/pixel-fixer pixel --help   # the CLI
node tools/pixel-fixer/bin/pixel.mjs check art.png   # the same, from any folder
```

## How to use it

1. **Grid.** The grid is detected when a picture opens. The note under
   **Auto-detect** gives the cell size, the output size, and a confidence. Below
   about 50%, check the pink grid lines against the picture. Fix it by typing
   the cell size and offset (fractions are fine: AI pictures are often scaled
   by 7.6 or 23.3), or choose **Lines** in the tools over the picture and drag a single
   line (**Move** only looks around). Number fields take math: type
   `1015/51` (51 pixels across 1015 source pixels), or `*2` or `/2` to
   double or halve the value there; ArrowUp and ArrowDown step it (with
   Shift, ten steps), and Escape puts it back. Lines moved by hand
   turn yellow. **Follow drifting lines** moves every line onto its nearest
   edge, for pictures whose cells grow or shrink across the picture.
   **Size** makes the picture smaller than one pixel per cell (a width, or
   ½, ⅓, ¼): each new pixel merges a block. **Keep outlines** lets a dark
   line through a block win over its most common color, so one-pixel
   outlines survive; a lone dark pixel does not.
2. **Palette.** Pick a preset (Game Boy, PICO-8, Sweetie 16, DawnBringer
   16/32, Endesga 32, NES, AAP-64, Ritmo), import a `.hex` or `.gpl` file, paste hex
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
   color, choose **Pick** in the tools over the picture and click it, on either side.
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
4. **Background.** **Remove the background** (on by default) makes it transparent. The
   colors covering most of the border are the background (one, or the two
   tones of a fake checkerboard an image generator painted in); it is flooded
   inward from the border and stops at the outline. It is found in each
   pixel's own color, before the palette, so a palette with no color for the
   background cannot merge it into a dark outline. **Tolerance** sets how
   close a color must be; **Also enclosed areas** removes background-colored
   gaps the border cannot reach (and same-colored highlights); **Remove
   specks** clears groups of up to 3 pixels left alone in the background.
   To edit by hand, pick **Erase** or **Restore** in the tools over the
   picture (instead of **Move**) and paint on the fixed picture, with a **Pixel** or **Area**
   (the whole connected area of one color) brush.
   **Paint** colors pixels by hand, for the one pixel the matching got
   wrong: choose a color beside the brush (or Alt-click a pixel to take its
   color) and paint, with the same **Pixel** or **Area** brushes. A painted
   color snaps to the nearest palette color, so it follows palette changes;
   painted pixels are outlined in white, and show even where the background
   was removed. Hand edits work with or without removing the background,
   apply in the order made, are saved in the recipe, and are dropped when
   the picture's size changes.
5. **Compare.** **Source**, **Compare** (a split you can drag), and **Fixed**
   views. Zoom with the wheel, a pinch, or the buttons; drag to pan; double-click
   to fit.
6. **Check.** What `pixel check` says about the fixed picture: confident or
   not, and every rule it breaks. Its **Rules** (sizes, max colors, and a
   transparent background) are the project's rules (a
   `pixel.config.json` opened on the page sets them); the palette chosen is
   one too.
7. **Export.** PNG at 1x (the true pixel art) or any whole scale; SVG in pixel
   units with crisp edges (it stays sharp at any size; same-colored areas are
   merged into rectangles); a JSON map (size, palette, one row of palette
   indices per pixel row, -1 for transparent); the palette as `.hex` or `.gpl`;
   **Sprite text** (the sprite source format below); and the **Recipe**.

**Undo** and **Redo** (in the top bar, or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z
or Ctrl+Y) cover every setting: the grid, the palette, the background,
strokes, and the size. A slider drag, a typed number, or a stroke is one
step. Opening another picture starts the history over.

## The CLI

`pixel` runs the page's pipeline from the command line, for agents. It is
built on Effect (`effect/cli`), outside the core, so the page carries none of
it. Every command prints a JSON report on stdout, and exits with what to do
next: 0 clean (or fixed with confidence), 2 a usage problem, a missing file,
or a broken sprite source, 3 fixable (rules broken: fix the picture or edit
the source), 4 needs a person (the grid is unsure: look at the preview).

| Command | What it does |
| --- | --- |
| `check <file>` | Clean pixel art, fixable with confidence, or needs a person? Writes nothing. |
| `fix <png>` | Fixes it, writing `.png` (1x), `@Nx.png` (`--scale N`), `.svg`, `.json` map, `.sprite.txt`, `.recipe.json`, and `.preview.png`. |
| `pixelate <png> -w N` | Cuts a picture that is not pixel art into N pixels across, on the palette (or `--colors N` proposed from it). |
| `render <sprite>` | Renders a sprite source or JSON map to PNG and SVG, and lints it. |
| `lint <file>` | The project's rules on the pixels as they are. |
| `preview <file>` | A picture to look at: the art enlarged, or the source and its grid beside the fix. |
| `compare <a> <b>` | Which of two versions is better, and why. |
| `palettes [name]` | The presets, or one palette's colors. |
| `init` | Writes a starting `pixel.config.json`. |

`fix`, `check`, `pixelate`, and `preview` take the page's settings as flags
(`--palette`, `--cell 8x8 --offset 2,3`, `--follow`, `--cleanup`,
`--remove-background`, `--dither`, `--metric`, `--shrink-to`), over a
`--recipe` file, over the config. `pixel <command> --help` lists them.

**`pixel.config.json`**, found from the working directory up (or
`--config`), holds a project's rules: `palette` (a preset's name, a list of
hex colors, or a `.hex`/`.gpl` file next to the config), `sizes`
(`["16x16", "32x32"]`), `maxColors`, `transparentBackground` (which also
removes the background when fixing), and `recipe` (settings every fix starts
from).

**Sprite sources** are pixel art as text, for art drawn with code: a
`palette` section of one-character keys, then a `pixels` section with one row
of keys per pixel row. `pixel render` checks every row and key and reports
each problem with its line.

```
# A coin. Lines starting with # are comments.
palette
. transparent
K #1a1c2c
Y #ffcd75

pixels
.KK.
KYYK
.KK.
```

**Recipes** are every setting as JSON (`src/core/recipe.ts`): the grid (found,
given as cells, or a size to pixelate to), the palette with its locked
colors, cleanup, background, size, and the hand edits. Missing settings take
their defaults, so `{"palette": "sweetie-16"}` is a recipe.

`skills/pixel-art/SKILL.md` is the skill for agents: which command for which
case, and how to read the reports. Link it into a game's skills folder.

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
  SVG, JSON), `demo.ts` (the fake AI picture generator),
  `pipeline.ts` (the whole fix, from a picture and a recipe: what the page and
  the CLI both run), `recipe.ts` (recipes as JSON), `sprite.ts` (sprite
  sources), `lint.ts` (the rules), `report.ts` (the check and its verdict),
  `preview.ts` (pictures to look at).
- `src/ui/`: the page (plain DOM and a canvas, no framework), exported as
  `@typeonce/pixel-fixer/page` and `/page.css` for the website to mount on `#app`.
- `src/cli/`: the `pixel` CLI (Effect), with PNG files through `pngjs`;
  `bin/pixel.mjs` runs it from its TypeScript source.
