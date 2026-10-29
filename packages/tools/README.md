# @typeonce/ritmo-tools

Asset tools for games made with [Ritmo](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md),
run by agents from the command line. One command, `ritmo-tools`, with one
tool per kind of asset:

| Tool | For |
| --- | --- |
| `ritmo-tools pixel` | Pixel art: fixes AI-made or blurry pictures and animation sheets onto a true pixel grid and a palette, renders sprites drawn as text, and checks a project's art against its rules. |
| `ritmo-tools sound` | Sound effects: keeps them as JSON recipes, measures and varies them, writes WAV files, and opens a local page where a person listens, picks, tunes, and notes. |
| `ritmo-tools music` | Game music: hears a person's hum for its tune, tempo, and key, keeps songs as JSON tracks of notes, checks them, writes WAV and MIDI files, and opens a local page where a person plays, edits notes, records, and comments. |

```sh
npx @typeonce/ritmo-tools pixel check art.png
pnpm add -D @typeonce/ritmo-tools   # pins it to the game's Ritmo version
```

Every command prints JSON on stdout and exits with a code that says what
to do next. A game's agent learns them from the skills that ship with
`@typeonce/ritmo` (`skills/ritmo-pixel-art`, `skills/ritmo-sounds`,
`skills/ritmo-music`), linked by
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
**Try the demo** for a fake AI picture of a mushroom. The same button opens a project PNG
(the picture with every setting it was saved with), a sprite source
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
   **Sprite text** (the sprite source format below); the **Recipe**; and the
   **Project PNG** (below).

**Undo** and **Redo** (in the top bar, or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z
or Ctrl+Y) cover every setting: the grid, the palette, the background,
strokes, and the size. A slider drag, a typed number, or a stroke is one
step. Opening another picture starts the history over.

### Animations

An image generator asked for an animation draws a sheet: the frames side by
side (or in rows, often one animation per row: walking each way, throwing,
exploding), each in a box, over a dark background with a painted grid,
often with a label under each frame. Open it like any picture: when the
fixer finds several boxes, most of them holding about as much art each (a
few faint ones, like the last smoke of an explosion, do not count against
it), it opens the sheet as an **Animation** and says so. **Picture** and **Animation** in the top bar
switch between the two at any time; everything about pictures above stays as
it is.

- **Frames.** The sheet's background is cleared from its border (the painted
  grid and the boxes with it), and each run of art is a frame: rows of art
  are split where the columns empty out, and short rows (the labels) are
  dropped. A box that still holds frames one over another (blocks side by
  side whose rows do not line up) is cut into rows again, and a frame of a
  few pixels set apart like the others (the last wisp of smoke) stays a
  frame. A grid painted behind the frames is painted out first, where it
  runs over the background, so lines as dark as the art's outline never
  flood into the art; how close a color must be to the background follows
  how noisy the background is. The **Sheet** view shows the source with every frame's box,
  numbered. Choose **Boxes** (F) to drag a box, resize it by its handles, or
  draw a new one on empty space when something was cut out; Delete removes the
  selected box. Each box is tinted with its animation's color.
- **Animations.** Each row of frames is one animation, named
  `animation-1`, `animation-2`, ... in reading order; where two blocks sit
  side by side (walking on the left, throwing on the right), a row across
  both is split where they meet, when its two parts hold as many frames as
  the blocks' rows. **Animations** on the right lists them: **In**/**Out**
  chooses which are exported (the others keep their frames and settings);
  choose one to play it, rename it (the name a game plays it by), and set its
  speed and loop. Its frames are listed under it: **In**/**Out** leaves one
  out without losing its box. **Split here**, on the line between two of
  its frames, cuts the animation in two there (the frames after it become a
  new animation), and **Join with** puts it together with the next one, for
  a sheet whose rows are not its animations. **Find again** starts over
  (boxes and animations changed by hand are dropped).
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
  (Shift: 4). Each animation gets its own canvas, the smallest that holds
  its frames; **Margin** sets the empty pixels around them.
- **Playing.** The **Play** view shows the chosen animation running, with the grid
  if you want it; Space plays and pauses, `,` and `.` step a frame, and the
  bar under it sets the frame rate, **Loop** or **Ping-pong**, and **Onion**
  (the previous frame, faint, under the current one). **Frames** shows them
  all side by side; click one to select it.
- **Export.** A **Sheet PNG** with every exported animation, each from a
  new row, its frames in one row or in rows of **Per row** frames, with
  **Spacing** between frames and animations, at any whole scale; its
  **JSON** in the hash format Pixi (`Spritesheet`), Phaser (`atlas`), and
  Aseprite share, with each frame's rectangle, duration, and anchor (frames
  are named `<animation> 0`, `<animation> 1`, ...), each animation's frame
  list under `animations`, and Aseprite's `frameTags`; a **GIF** of the
  chosen animation; **Frames .zip** (one PNG per frame, a folder per
  animation); the **Recipe** (frames, animations, and anchor included); and
  the palette.

Hand edits (**Erase**, **Paint**) and **Size** are for single pictures and
are not offered for animations.

### Project PNGs

A **Project PNG** (in Export) is the source picture with the recipe stored
inside it, so one file holds the whole session: open it on the page and every
setting comes back, hand edits included. It is how to share work in progress
or pick it up later; nothing leaves the device unless you send the file. It is
not a game asset: export the fixed art for that.

The picture's pixels are untouched (a PNG opened keeps its own bytes; another
format is stored as PNG). The recipe is one uncompressed `iTXt` text chunk
with the keyword `ritmo-pixel-recipe`, right after the header, holding the
recipe JSON: about 0.5 to 2 KB, more with many hand strokes. Viewers ignore
it. Some apps re-encode pictures and drop it (chat apps sending a photo as a
photo): send it as a file. A project PNG without its chunk opens as the plain
picture.

To see the recipe: `exiftool art.png`, `pngcheck -t art.png`, or
`grep -a ritmo-pixel-recipe art.png`. To remove it: `exiftool -all= art.png`,
`oxipng --strip safe art.png`, or `pngcrush -rem text in.png out.png`; what is
left is the plain picture. `ritmo-tools pixel fix --project` writes one from the CLI, and
`check`, `fix`, `sheet`, and `preview` run the recipe a project PNG holds (a
`--recipe` file wins over it; the report says `"storedRecipe": true` when it
ran).

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
| `fix <png>` | Fixes it, writing `.png` (1x), `@Nx.png` (`--scale N`), `.svg`, `.json` map, `.sprite.txt`, `.recipe.json`, and `.preview.png`; `--project` also writes `<name>.project.png`. |
| `sheet <png>` | Fixes an animation sheet: `.png` (each animation's frames in a strip from a new row, or `--columns N` per row), its `.json`, a `.<animation>.gif` each, `.frames/<animation>/` (one PNG per frame), `.recipe.json`, and `.preview.png` (the boxes found over the source, and each animation's fixed frames). The report lists the animations with their frame numbers. |
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
`--recipe` file (or the recipe a project PNG holds), over the config. `ritmo-tools pixel <command> --help` lists them. `sheet` takes them too, plus
`--boxes`, `--skip`, `--animations` (which frames make which animation:
`"walk=1-4;throw=5-8;explode=9-18"`, every frame in one), `--only` (the
animations to write, by name: `"walk,explode"`), `--anchor`, `--fps`,
`--pingpong`, `--columns`, and `--spacing`. Every command reads PNG and JPEG.

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
  the CLI both run), `recipe.ts` (recipes as JSON), `project.ts` (project
  PNGs: the recipe in a PNG text chunk), `sprite.ts` (sprite
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

The website hosts the same page with Spirit call's bank, kept in the tab, to
try without the CLI: https://ritmo.typeonce.dev/tools/sound/.

### Code

- `src/sound/core/`: recipes (`recipe.ts`), the renderer (`render.ts`, plain
  TypeScript that plays the same in Node and the browser), the measures and
  checks (`measure.ts`), takes (`takes.ts`), reviews (`review.ts`), and WAV
  files (`wav.ts`).
- `src/sound/cli/`: the `sound` command (Effect), and the review page's
  server (`serve.ts`).
- `src/sound/ui/`: the review page, built from the pixel fixer's kit
  (`lab.ts`), reading and writing through a store (`store.ts`): the CLI's
  server (`main.ts`), or the tab for the website's demo (`demo.ts`). The
  published package carries it built (`dist/sound/page`, made by `prepack`);
  inside the repository Vite serves it from source.

## Music lab (`ritmo-tools music`)

Game music as JSON songs, for agents and the people they make games with,
most of whom are not musicians. The person hums the tune they have in mind
(or gives a recording); the tool listens and writes down its tempo, key, and
melody; the agent builds a song around it; the person plays it, edits notes
on a grid, swaps instruments, and comments on bars, on a local page in the
pixel fixer's look. One renderer serves the page, the checks, and the WAV,
so what the person hears is what the agent measured.

### Songs

```json
{
  "version": 1,
  "about": "Village at dusk: the hum's tune on a flute over picked guitar.",
  "tempo": 93,
  "key": "D minor",
  "bars": 8,
  "master": 0.65,
  "tracks": [
    { "name": "Melody", "instrument": "flute", "volume": 0.6, "reverb": 0.35, "notes": [
      { "at": 0, "length": 1, "pitch": "D5" },
      { "at": 1, "length": 0.5, "pitch": "F5", "velocity": 0.7 }
    ] },
    { "name": "Drums", "instrument": "drums", "volume": 0.9, "reverb": 0.15, "notes": [
      { "at": 0, "length": 0.5, "pitch": "kick" }
    ] }
  ]
}
```

Time is in beats from the start (`at: 4` is bar 2 in 4/4); `length` is in
beats; `pitch` is a note name (`"C4"` is middle C, `"F#3"`, `"Bb2"`) or, on a
drum track, a drum (`kick`, `snare`, `hat`, `openHat`, `clap`, `tomLow`,
`tomHigh`, `crash`, `rim`, `shaker`); `velocity` (0 to 1, default 0.8) is how
hard a note is played. A song has `beatsPerBar` (default 4), `loop` (default
true: the WAV is one pass long and its tail wraps into its start, so it
repeats without a seam), `master`, and `compressor` (default false: true
squeezes the whole mix louder and punchier, its peaks held under -1 dBFS,
for rock, drum & bass, and electronic songs; stems stay uncompressed, for
the game to mix); a track has `volume`, `pan` (-1 to
1), `reverb` (0 to 1), and `mute`. The key is a note and a scale: `major`,
`minor`, `harmonic minor`, `dorian`, `phrygian`, `lydian`, `mixolydian`,
`major pentatonic`, `minor pentatonic`, `blues`.

The instruments are synthesized from small models of the real ones (a
plucked string, struck strings, a breath through a tube), so they need no
sample files and play the same bits everywhere:

| Instrument | For |
| --- | --- |
| `piano`, `epiano` | Chords, melodies; the electric piano for mellow, lo-fi tunes. |
| `guitar`, `bass` | Picked or strummed chords; the low line under them. |
| `rockGuitar` | An overdriven electric guitar: riffs and power chords (a note and the one seven semitones up). |
| `reese` | The drum & bass bass: detuned saws, a sub, and grit; long notes. |
| `strings`, `pad` | Long held chords that swell in. |
| `flute`, `marimba`, `bells` | Melodies; short bright patterns; sparkle. |
| `synthLead` | A supersaw: modern electronic leads and riffs. |
| `chipLead`, `chipBass` | Chiptune: a retro console's square and triangle waves. |
| `drums`, `breaks` | A clean drum kit; a punchy, driven one for rock and drum & bass (the same drums). |

A song's `reference` is what `music listen` heard: its `tempo`, `key`, the
melody as `notes` rounded to the grid, the raw pitch line (`contour`), and the
audio file it came from. The review lives next to the song
(`theme.song.json` → `theme.song.review.json`): the status (`new`,
`approved`, `changes`), a note, comments pinned to bars (and a track), and
the person's edits since the agent last wrote the song, a line each.
`examples/village.song.json` in the repository is a song built around a
hum (`examples/village.song.reference.wav`, a synthesized test hum).

### Listening

`music listen` follows the strongest pitch moment to moment (YIN, the
standard pitch tracker for one voice), cuts it into notes where the pitch
jumps or the voice restarts, finds the tempo whose beats line up best with
where the notes start, and the key whose notes match how long each pitch
sounds (Krumhansl's key profiles, over the whole spectrum). A voice that
sits off pitch the whole way, as most people's do, is heard in tune: the
offset (`tuning`, in cents, in the report) is measured over all its notes
and taken out before they are named. It hears one voice (a hum, a
whistle, a lead line): on a full song or in a noisy room it finds a tempo
and a key but few notes, and says so (hum the part alone instead). A tapped
beat with no tune gives a tempo and no notes. When the song already has a
tempo and the hum was sung along to it, `--tempo` puts the notes on the
song's grid.

### The command line

`npx @typeonce/ritmo-tools music <command>` (inside the Ritmo repository,
`node packages/tools/bin/ritmo-tools.mjs music <command>`). Every command
prints JSON and exits 0 (clean), 2 (usage error, missing file, broken song),
or 3 (the song clips or is silent).

| Command | Does |
| --- | --- |
| `ritmo-tools music listen <song> <audio.wav> [--tempo 96]` | Hears a hum, a whistle, or a tapped beat and writes its tempo, key, and melody into the song as its reference; makes the song if it does not exist. |
| `ritmo-tools music instruments` | Lists the instruments (what each is for, its range), the drums, and the scales. |
| `ritmo-tools music init [song]` | Writes a starting song: four bars of piano chords, a bass line, and a beat. |
| `ritmo-tools music check <song>` | Measures the song (length, peak, loudness, each track's loudness and range) and lists what usually sounds wrong: clipping, silence, notes outside the key or an instrument's range, a buried track, a doubled note, and with a reference, how closely the melody follows it. |
| `ritmo-tools music render <song> [-o file.wav] [--stems]` | Writes the song as a stereo WAV and a MIDI file, and with `--stems` each track alone. |
| `ritmo-tools music review <song> [--port 5191] [--host]` | Serves the review page and prints its address; runs until stopped. |
| `ritmo-tools music notes <song>` | What the person said: the status, the note, comments in song order with their bars, and their edits. |

### The review page

`ritmo-tools music review` opens the song on a local page: the reference and
the tracks on the left (mute and solo each), the arrangement (every track
as a lane under the bar numbers, with the hum's pitch line above them) and
the chosen track's note grid on the stage, and on the right the review, the
comments, the track (instrument, volume, pan, room), the song (tempo, key,
bars, loop, compressor, master), the reference, and the check. On the grid, a click
places a note (and plays it), a drag moves it, dragging its end stretches
it, and a double-click or right-click removes it; the key's notes are a
shade lighter, and the hum's notes show as dashed outlines with its pitch
line through them. A click on the bar numbers, or on a lane of the
arrangement, puts the start marker there (while playing, the bar numbers
jump the music there); dragging across the bar numbers picks bars to
comment on, and Play starts from them. Record a hum records from the microphone (the page must be on
localhost or HTTPS); Audio file, or dropping a file on the stage, takes any
audio the browser plays. Space plays and pauses (Play goes on from where
it paused), Stop goes back to the start, the microphone
button plays the hum along with the song, Delete removes the chosen note,
and Ctrl/Cmd+Z undoes. MIDI and WAV download the song. Every change is
written to the song and its review as it happens, and a song the agent
rewrites while the page is open shows up in it.

The website hosts the same page with the village song and its hum, kept in
the tab, to try without the CLI: https://ritmo.typeonce.dev/tools/music/.

### Code

- `src/music/core/`: songs (`song.ts`), the instruments (`instruments.ts`),
  the renderer (`render.ts`), listening (`listen.ts`), checks (`check.ts`),
  reviews and edits in words (`review.ts`), WAV (`audio.ts`) and MIDI
  (`midi.ts`) files. Plain TypeScript that runs the same in Node and the
  browser.
- `src/music/cli/`: the `music` command (Effect), and the review page's
  server (`serve.ts`).
- `src/music/ui/`: the review page (`lab.ts`): the canvases (`grid.ts`),
  playing (`player.ts`), recording (`record.ts`), reading and writing
  through a store (`store.ts`): the CLI's server (`main.ts`), or the tab for
  the website's demo (`demo.ts`). The published package carries it
  built (`dist/music/page`, made by `prepack`); inside the repository Vite
  serves it from source.
