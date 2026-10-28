# @typeonce/ritmo-tools

Asset tools for games made with [Ritmo](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md),
run by agents from the command line. One command, `ritmo-tools`, with one
tool per kind of asset:

| Tool | For |
| --- | --- |
| `ritmo-tools pixel` | Pixel art: fixes AI-made or blurry pictures and animation sheets onto a true pixel grid and a palette, renders sprites drawn as text, and checks a project's art against its rules. |
| `ritmo-tools sound` | Sound effects: keeps them as JSON recipes, measures and varies them, writes WAV files, and opens a local page where a person listens, picks, tunes, and notes. |

```sh
npx @typeonce/ritmo-tools pixel check art.png
pnpm add -D @typeonce/ritmo-tools   # pins it to the game's Ritmo version
```

Every command prints JSON on stdout and exits with a code that says what
to do next. A game's agent learns them from the skills that ship with
`@typeonce/ritmo` (`skills/ritmo-pixel-art`, `skills/ritmo-sounds`), linked by
its `SETUP.md`.
The tools are built on Effect; nothing a game imports depends on this
package.

## Pixel fixer (`ritmo-tools pixel`)

Turns blurry or AI-made pixel art into true pixel art. Image generators draw
"pixel art" as a large picture whose fake pixels are uneven, blurred, and
slightly off-color. The fixer finds the hidden pixel grid, gives each cell
one color from a palette you choose, and exports the result at its true size
(or any whole scale), as PNG, SVG, or a JSON map. It fixes animations too:
a sheet of frames in boxes, as image generators draw one, becomes frames on
one grid and one palette that stand still on one spot, exported as a sprite
sheet with its JSON, a GIF, and each frame.

It comes in two parts that share one core: a web page for people tuning art
by hand (it runs entirely in the browser; pictures never leave the device),
and the `ritmo-tools pixel` command for agents that check, fix, and make art on their own.
A recipe saved by one runs in the other.

The page wears Ritmo's brand (`brand/README.md`): its colors, its mark as the
logo, and its Tick orange only on what is active or selected. The palette
presets include Ritmo's own six colors.

### Run it

The page is part of the website, at https://ritmo.typeonce.dev/tools/pixel/
(`website/src/pages/tools/pixel/index.astro` mounts it). It is built and
deployed with the site, so locally it runs with the site too:

```sh
pnpm install
pnpm --dir website dev            # http://localhost:4321/tools/pixel/
pnpm --dir website dev --host     # also reachable from a phone on the same network
pnpm --dir website build          # the site, with the page at dist/tools/pixel/
```

Open a picture (PNG or JPEG: **Open** in the top bar, drag and drop, or paste), or press
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
npx @typeonce/ritmo-tools pixel --help      # the CLI
node packages/tools/bin/ritmo-tools.mjs pixel check art.png   # from its source, inside the Ritmo repository
```

### How to use it

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
   specks** clears groups of up to 3 pixels left alone in the background;
   **Remove the shadow** (off by default) also takes a drop shadow under the
   subject: the background's color made darker, against the background with
   no outline, in the bottom half of the subject. It can take a grey part of
   the subject that has no outline, so check the result; erasing the shadow
   by hand with the **Area** brush is often one click.
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
7. **Export.** **Crop to the subject** drops the transparent margins, so
   the export is only the box around what is left (the editor keeps the
   whole picture, lined up with the source). PNG at 1x (the true pixel art) or any whole scale; SVG in pixel
   units with crisp edges (it stays sharp at any size; same-colored areas are
   merged into rectangles); a JSON map (size, palette, one row of palette
   indices per pixel row, -1 for transparent); the palette as `.hex` or `.gpl`;
   **Sprite text** (the sprite source format below); and the **Recipe**.

**Undo** and **Redo** (in the top bar, or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z
or Ctrl+Y) cover every setting: the grid, the palette, the background,
strokes, and the size. A slider drag, a typed number, or a stroke is one
step. Opening another picture starts the history over.

### Animations

An image generator asked for an animation draws a sheet: the frames side by
side (or in rows), each in a box, over a dark background with a painted grid,
often with a label under each frame. Open it like any picture: when the
fixer finds several boxes holding about as much art each, it opens the sheet
as an **Animation** and says so. **Picture** and **Animation** in the top bar
switch between the two at any time; everything about pictures above stays as
it is.

- **Frames.** The sheet's background is cleared from its border (the painted
  grid and the boxes with it), and each run of art is a frame: rows of art
  are split where the columns empty out, and short rows (the labels) are
  dropped. A grid painted behind the frames is painted out first, where it
  runs over the background, so lines as dark as the art's outline never
  flood into the art; how close a color must be to the background follows
  how noisy the background is. The **Sheet** view shows the source with every frame's box,
  numbered. Choose **Boxes** (F) to drag a box, resize it by its handles, or
  draw a new one on empty space when something was cut out; Delete removes the
  selected box. **Frames** on the right lists every frame: **In**/**Out**
  leaves one out of the animation without losing its box, and **Find again**
  starts over (boxes changed by hand are dropped).
- **Grid and palette.** Every frame is read on one cell size (found from all
  the frames together, or typed), each at its own offset, and fixed with one
  recipe: the palette, matching, and cleanup are the picture's settings, and
  **Propose colors** proposes from all the frames at once.
- **Lining up.** Frames are drawn wherever the generator put them in their
  boxes, so they drift. **Anchor** says what lines them up: **Ground** (the
  default) lines up the body's middle column and keeps each frame at the
  height it was drawn, so a hop or a bob stays; **Feet** pins the body's
  lowest row to one spot (hops are flattened); **Center** pins the body's
  middle, for things that float; **Box** places frames as cut. Arrow keys nudge the selected frame by a pixel
  (Shift: 4). **Margin** sets the empty pixels around the frames.
- **Playing.** The **Play** view shows the animation running, with the grid
  if you want it; Space plays and pauses, `,` and `.` step a frame, and the
  bar under it sets the frame rate, **Loop** or **Ping-pong**, and **Onion**
  (the previous frame, faint, under the current one). **Frames** shows them
  all side by side; click one to select it.
- **Export.** A **Sheet PNG** with every frame in one row or in rows of
  **Per row** frames, with **Spacing** between them, at any whole scale; its
  **JSON** in the hash format Pixi (`Spritesheet`), Phaser (`atlas`), and
  Aseprite share, with each frame's rectangle, duration, and anchor, the
  animation's frame list, and Aseprite's `frameTags`; a **GIF**; **Frames
  .zip** (one PNG per frame); the **Recipe** (frames, anchor, frame rate, and
  loop included); and the palette.

Hand edits (**Erase**, **Paint**) and **Size** are for single pictures and
are not offered for animations.

### The CLI

`ritmo-tools pixel` runs the page's pipeline from the command line, for agents. It is
built on Effect (`effect/cli`), outside the core, so the page carries none of
it. Every command prints a JSON report on stdout, and exits with what to do
next: 0 clean (or fixed with confidence), 2 a usage problem, a missing file,
or a broken sprite source, 3 fixable (rules broken: fix the picture or edit
the source), 4 needs a person (the grid is unsure: look at the preview).

| Command | What it does |
| --- | --- |
| `check <file>` | Clean pixel art, fixable with confidence, or needs a person? Writes nothing. |
| `fix <png>` | Fixes it, writing `.png` (1x), `@Nx.png` (`--scale N`), `.svg`, `.json` map, `.sprite.txt`, `.recipe.json`, and `.preview.png`. |
| `sheet <png>` | Fixes an animation sheet: `.png` (the frames in a strip, or `--columns N` per row), its `.json`, a `.gif`, `.frames/` (one PNG each), `.recipe.json`, and `.preview.png` (the boxes found over the source, and the fixed frames). |
| `pixelate <png> -w N` | Cuts a picture that is not pixel art into N pixels across, on the palette (or `--colors N` proposed from it). |
| `render <sprite>` | Renders a sprite source or JSON map to PNG and SVG, and lints it. |
| `lint <file>` | The project's rules on the pixels as they are. |
| `preview <file>` | A picture to look at: the art enlarged, or the source and its grid beside the fix. |
| `compare <a> <b>` | Which of two versions is better, and why. |
| `palettes [name]` | The presets, or one palette's colors. |
| `init` | Writes a starting `pixel.config.json`. |

`fix`, `check`, `pixelate`, and `preview` take the page's settings as flags
(`--palette`, `--cell 8x8 --offset 2,3`, `--follow`, `--cleanup`,
`--remove-background`, `--crop`, `--dither`, `--metric`, `--shrink-to`), over a
`--recipe` file, over the config. `ritmo-tools pixel <command> --help` lists them. `sheet` takes them too, plus
`--boxes`, `--skip`, `--anchor`, `--fps`, `--pingpong`, `--columns`, and
`--spacing`. Every command reads PNG and JPEG.

**`pixel.config.json`**, found from the working directory up (or
`--config`), holds a project's rules: `palette` (a preset's name, a list of
hex colors, or a `.hex`/`.gpl` file next to the config), `sizes`
(`["16x16", "32x32"]`), `maxColors`, `transparentBackground` (which also
removes the background when fixing), and `recipe` (settings every fix starts
from).

**Sprite sources** are pixel art as text, for art drawn with code: a
`palette` section of one-character keys, then a `pixels` section with one row
of keys per pixel row. `ritmo-tools pixel render` checks every row and key and reports
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

**Recipes** are every setting as JSON (`src/pixel/core/recipe.ts`): the grid (found,
given as cells, or a size to pixelate to), the palette with its locked
colors, cleanup, background, size, the hand edits, and for an animation its
`sheet` (each frame's box, whether it is in, and its nudge; the anchor, frame
rate, loop, and margin). Missing settings take
their defaults, so `{"palette": "sweetie-16"}` is a recipe.

The `ritmo-pixel-art` skill, shipped with `@typeonce/ritmo`, is the guide for
agents: which command for which case, and how to read the reports.

### How the grid is found

`src/pixel/core/grid.ts`. For each axis, the picture's edge profile (how sharply the
color changes across each column or row boundary) repeats at the cell size.
Its spectrum gives candidate sizes; each is refined to a few thousandths of a
pixel with its offset, then judged by how often the middle of its cells holds
an edge (the true size almost never; a wrong size often). Among the clean
candidates, the one whose lines are strongest wins: that rules out fractions
of the true size, which are as clean but have half their lines mid-cell.

### Limits

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

### Code

- `src/pixel/core/`: the headless core, tested in `test/` with fake AI pictures made
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
  `preview.ts` (pictures to look at), `sheet.ts` (clearing a sheet, finding
  its frames, anchors, and laying frames on one canvas), `animation.ts` (the
  whole fix for a sheet), `spritesheet.ts` (sheet layouts and their JSON),
  `gif.ts` (animated GIFs), `zip.ts` (stored ZIP files).
- `src/pixel/ui/`: the page (plain DOM and a canvas, no framework; `player.ts` plays
  animations), exported as
  `@typeonce/ritmo-tools/pixel/page` and `/pixel/page.css` inside the repository
  for the website to mount on `#app` (the published package ships the CLI only).
- `src/pixel/cli/`: the `pixel` command (Effect), with PNG files through `pngjs` and
  JPEG through `jpeg-js`;
  `src/cli.ts` is `ritmo-tools` itself, and `bin/ritmo-tools.mjs` runs it from
  its TypeScript source inside the repository.

## Sound lab (`ritmo-tools sound`)

Game sounds as JSON recipes, for agents and the people they make games with.
An agent writes and checks sounds from the command line; a person listens,
compares, tunes, and notes them on a local page in the pixel fixer's look.
Both use one renderer, so what the person hears, what the agent measures,
and what the game plays are the same samples.

Its page is built from the pixel fixer's kit, so the two tools look and
work alike.

### Recipes and banks

A recipe is a few layers built from small instruments, mixed into a room:

```json
{
  "about": "A blow lands: a short thud and a crack.",
  "reverb": 0.12,
  "layers": [
    { "type": "click", "gain": 0.45 },
    { "type": "tone", "wave": "sine", "from": 160, "to": 55, "duration": 0.12, "attack": 0.002, "gain": 0.65 },
    { "type": "crunch", "from": 1500, "to": 500, "duration": 0.07, "gain": 0.3 }
  ]
}
```

| Layer | What it is |
| --- | --- |
| `tone` | A wave (`sine`, `triangle`, `square`, `sawtooth`) gliding `from` → `to` Hz: thuds, notes, hums. |
| `noise` | Noise through a filter (`lowpass`, `highpass`, `bandpass`) gliding `from` → `to` Hz, with `q`: air, hiss, rumble. |
| `swish` | A band of noise rising from `low` to `peak` Hz, loudest at `peakAt`: a swing. |
| `crunch` | Distorted band-passed noise: the crack of a blow. |
| `metal` | Inharmonic partials of `pitch` Hz, the higher dying first: a ring. |
| `click` | A short tick at the very start, for punch. |

Every layer has `gain` and an optional `delay` in seconds. A recipe may
carry `heavy` (it ducks the others in the game's mixer), `interval` (the
least time between two plays), and a `tune` the person set with sliders
(`pitch`, `length`, `brightness`, `echo`, `volume`), kept apart from the
layers so it reads at a glance.

A bank is one file of named recipes and the game's master volume:
`{"version": 1, "master": 0.6, "sounds": {...}}`. Its review lives next to
it (`game.sounds.json` → `game.sounds.review.json`): each sound's status
(`new`, `approved`, `changes`), the person's note, and the takes offered.
`examples/spirit-call.sounds.json` in the repository is Spirit call's 46 sounds.

### The command line

`npx @typeonce/ritmo-tools sound <command>` (inside the Ritmo repository, `node packages/tools/bin/ritmo-tools.mjs sound <command>`).
Every command prints JSON and exits 0 (clean), 2 (usage error, missing
file, broken bank), or 3 (a sound has errors).

| Command | Does |
| --- | --- |
| `ritmo-tools sound init [bank]` | Writes a starting bank of three sounds. |
| `ritmo-tools sound check <bank> [names...]` | Measures each sound (length, peak, loudness, attack, brightness, ending) and lists what breaks the rules: clipping, silence, a late start, a click at the end, much louder or quieter than its kind. |
| `ritmo-tools sound render <bank> [names...] [-o dir] [--sequence 0.25]` | Writes WAV files, and with `--sequence` the sounds in a row. |
| `ritmo-tools sound vary <bank> <name> --toward heavier [--count 4] [--seed 1]` | Makes takes nudged one way (`heavier`, `lighter`, `brighter`, `darker`, `punchier`, `softer`, `shorter`, `longer`, or `wider` for anything) and offers them in the review. |
| `ritmo-tools sound review <bank> [--port 5190] [--host]` | Serves the review page and prints its address; runs until stopped. |
| `ritmo-tools sound notes <bank>` | What the person said: status and note for each sound, changes asked first. |

### The review page

`ritmo-tools sound review` opens the bank on a local page: the sounds on the left with
their status, the selected sound's wave and layers on the stage with the
takes beside each other, and on the right its review, its check, the takes
maker, tune sliders, and the layers' numbers (takes and layers start closed).
Space plays, the arrows move through the list, 1 to 9 play the takes, and
Ctrl/Cmd+Z undoes. Every change is written to the bank and its review as it
happens, and changes the agent writes while the page is open show up in it.
`--host` serves it on the network too, to listen on a phone.

### Code

- `src/sound/core/`: recipes (`recipe.ts`), the renderer (`render.ts`, plain
  TypeScript that plays the same in Node and the browser), the measures and
  checks (`measure.ts`), takes (`takes.ts`), reviews (`review.ts`), and WAV
  files (`wav.ts`).
- `src/sound/cli/`: the `sound` command (Effect), and the review page's
  server (`serve.ts`).
- `src/sound/ui/`: the review page, built from the pixel fixer's kit. The
  published package carries it built (`dist/sound/page`, made by `prepack`);
  inside the repository Vite serves it from source.
