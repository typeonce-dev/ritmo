# @typeonce/ritmo-tools

Asset tools for games made with [Ritmo](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md),
run by agents from the command line. One command, `ritmo-tools`, with one
tool per kind of asset:

| Tool | For |
| --- | --- |
| `ritmo-tools pixel` | Pixel art: fixes AI-made or blurry pictures and animation sheets onto a true pixel grid and a palette, renders sprites drawn as text, bakes sprites from models of 3D shapes, makes normal maps for art a game lights, checks a project's art against its rules, and opens a local page with all of a game's art by folder, where a person looks at each piece at whole-number zooms, plays its animations, sees the whole set side by side, approves, and pins comments to an area of pixels. |
| `ritmo-tools sound` | Sound effects: keeps them as JSON recipes, measures and varies them, writes WAV files, and opens a local page where a person listens, picks, tunes, and notes. |
| `ritmo-tools fx` | Pixel art effects: keeps each effect as a few drafts written as code, checks them for pixel art craft and the project's rules, draws contact sheets an agent can look at, writes sprite sheets and GIFs, and opens a local page where a person watches the drafts side by side, picks, tunes, and pins comments to a pixel. |
| `ritmo-tools music` | Game music: hears a person's hum for its tune, tempo, and key, keeps songs as JSON tracks of notes, checks them, writes WAV and MIDI files, and opens a local page with all of a game's music on one list, songs and plain audio files, where a person plays, edits notes, records, approves, and comments. |

```sh
npx @typeonce/ritmo-tools pixel check art.png
pnpm add -D @typeonce/ritmo-tools   # pins it to the game's Ritmo version
```

Every command prints JSON on stdout and exits with a code that says what
to do next. A game's agent learns them from the skills that ship with
`@typeonce/ritmo` (`skills/ritmo-pixel-art`, `skills/ritmo-sounds`,
`skills/ritmo-music`, `skills/ritmo-fx`), linked by
its `SETUP.md`.
The tools are built on Effect; nothing a game imports depends on this
package.

All four tools share these rules:

- **Exit codes.** 0 clean, 2 a usage problem, a missing file, or a broken
  file (its `problems` listed), 3 fixable, 4 needs a person (pixel only);
  each tool's section says what 3 and 4 mean for it. 1 is a failure the tool
  did not expect (a draft's own code that throws, or a bug): one line on
  stderr and `{"error": "<tool> <command> failed: ..."}` on stdout, never a
  stack trace.
- **Stopping.** SIGTERM or SIGINT (`kill`, `timeout`, Ctrl-C) ends a
  command at once, even one stuck in a draft's own code. A review page's
  server, which runs until stopped, stops on either and exits 130.
- **Number flags** take a range (`--count` 1 to 12, `--scale` 1 to 32, a
  `--port` 1 to 65535, ...). A value outside it is refused as a usage error,
  naming the flag, the value, and the range (exit 2), never clamped.
- **Unknown keys** in a file the agent writes (`pixel.config.json`, a
  recipe, a bank, a song, a model) are problems, each with the nearest key
  the file takes (`unknown key maxColours: did you mean maxColors?`), so a
  typo never turns a setting off.
- **Review pages** answer only on this machine (`localhost`, `127.0.0.1`,
  or `[::1]` on their port, and with `--host` the addresses printed): a
  request naming any other host gets 403, so a web page open elsewhere
  cannot reach a game's files. Each save carries the version of the file the
  page read; when the agent wrote the file meanwhile, the page lays the
  person's change over the agent's and saves again, so neither is lost. Files
  are written whole (to a file beside them, then renamed), by the pages and
  the commands, so a reader never sees half of one.
- **Notes** say the same things in every tool: a `summary` of what is left,
  each piece's status and note, `changedSinceApproved` for an approved piece
  that changed, `unrecorded: true` for an approval that kept no record of
  what was seen, or only part of it (from an older version, or edited by
  hand: ask the person to look again; it is not counted among the approved),
  and `gone`, what was
  said about pieces no longer found (renamed or deleted), with where the
  review is to move or remove it.

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
A recipe saved by one runs in the other. The command also opens a review
page on localhost, where a person goes through all of a game's art and the
agent reads back what to change (see "The review page" below).

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
   turn yellow. **Follow lines** moves the lines onto the picture's edges:
   **Straight** places every line at once (each on a strong edge, every gap
   near the cell size), for cells that drift or are uneven; **Bend** places
   them in each row and column of cells on its own, so a line bends where
   the generator warped the grid (off by default: on a straight grid it
   changes nothing). **Outlines** handles one-pixel dark outlines that an
   image generator drew off the grid: a stroke a grid line split between two
   pixels goes back to one (never breaking the outline or a corner), and
   followed lines keep off dark strokes. **Auto** turns it on when the
   picture's dark strokes are about one cell wide, and says which it chose.
   **Size** makes the picture smaller than one pixel per cell (a width, or
   ½, ⅓, ¼): each new pixel merges a block. **Keep outlines** carries the
   outlines over as strokes: thinned back to one pixel, never broken, with
   one-pixel steps turned into clean diagonals; a lone dark pixel does not
   grow into a block.
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
  out without losing its box, and choosing one sets how many **beats** it
  holds (a beat is one frame at the animation's speed). **Split here**, on the line between two of
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
  Aseprite share, with each frame's rectangle, `duration` in milliseconds
  (play by it: frames can hold for different times), and anchor (frames
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
| `sheet <png>` | Fixes an animation sheet: `.png` (each animation's frames in a strip from a new row, or `--columns N` per row), its `.json`, a `.<animation>.gif` and `.<animation>.onion.png` each, `.frames/<animation>/` (one PNG per frame), `.recipe.json`, and `.preview.png` (the boxes found over the source, and each animation's fixed frames). The report lists the animations with their frame numbers and each frame's time in milliseconds. |
| `pixelate <png> -w N` | Cuts a picture that is not pixel art into N pixels across, on the palette (or `--colors N` proposed from it). |
| `render <sprite>` | Renders a sprite source or JSON map to PNG and SVG, and lints it. |
| `bake <model>` | Draws a model of 3D shapes (`<name>.bake.json`, see "Baking") through the project's one camera and light: `.png`, `.sprite.txt` for a still or `.json` for a sheet, `.preview.png`, and `.normal.png` and `.shadow.png` when the model asks. |
| `lint <file>` | The project's rules on the pixels as they are; with `--tile both` (or `x`, `y`), also that a tile's edges meet. |
| `preview <file>` | A picture to look at: the art enlarged, the source and its grid beside the fix, or with `--tile both` (or `x`, `y`) the art at its own size repeated. |
| `compare <a> <b>` | Which of two versions is better, and why. |
| `palettes [name]` | The presets, or one palette's colors. |
| `init` | Writes a starting `pixel.config.json`. |
| `normals <art> [--preset character\|object\|architecture\|terrain] [--strength N] [--force]` | Makes a normal map beside the art: `.normal.png`, `.normals.json` (what it was made from, and corrections), and `.lit.png` (a picture of it lit from each side). See "Normal maps". |
| `review <paths...> [--port 5193] [--host]` | Serves the review page for the PNGs, text sprites, and folders named, and prints its address; runs until stopped. |
| `notes <paths...>` | What the person said about the same paths: a `summary` of what is left, then `assets`, each one's status, note, open comments (numbered, with their area and frame, and `about: "map"` on those about its normal map), how many are resolved, `changedSinceApproved` (or `unrecorded`), the lint, and `next`, changes asked first. An asset with several parts also lists `parts`, each with its own status and note, and `goneParts` for reviewed parts it no longer has. `gone` lists reviews whose file is no longer found. |
| `resolve <asset> <numbers...> [--reply "what changed"]` | Marks comments as resolved: `pixel notes` stops listing them, and the page shows them done with the reply. The person can reopen one. |

`review`, `notes`, and `resolve` exit 0 or 2 only: what the lint says about
the art is in the notes, never a failure of them.

`fix`, `check`, `pixelate`, and `preview` take the page's settings as flags
(`--palette`, `--cell 8x8 --offset 2,3`, `--follow straight` or `bend`,
`--outlines auto|on|off`, `--cleanup`, `--remove-background`, `--crop`,
`--dither`, `--metric`, `--shrink-to`), over a
`--recipe` file (or the recipe a project PNG holds), over the config. `ritmo-tools pixel <command> --help` lists them. `sheet` takes them too, plus
`--boxes`, `--skip`, `--animations` (which frames make which animation:
`"walk=1-4;throw=5,6x3,7,8;explode=9-18"`, every frame in one, where `6x3`
holds frame 6 for 3 beats), `--only` (the
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
`sheet` (each frame's box, whether it is in, its nudge, and its beats; the
anchor, frame rate, loop, and margin). Missing settings take
their defaults, so `{"palette": "sweetie-16"}` is a recipe.

The `ritmo-pixel-art` skill, shipped with `@typeonce/ritmo`, is the guide for
agents: which command for which case, and how to read the reports.

**The onion picture** (`<name>.<animation>.onion.png`) shows an animation as a
still, for an agent that cannot watch it: a panel per step of playback, each
frame in its own colors over the frame before in red and the frame after in
blue (purple where both are). A frame that jumps, drifts, or changes size shows
as a thick band; the first panel's red is the last frame played, the loop's
seam. Faint lines cross at the anchor, and a held frame has a tick per beat
under it.

**Tile seams.** `lint --tile` warns (`seam`) when the step from a tile's last
line back to its first changes the color much more than the tile's other lines
do. A line along the edge, or a shape with its other side inside the tile, is
the pattern and passes. Measured on known tiles, it flagged none of 52 that loop
and 11 of 20 that do not; the misses are soft, and `preview --tile` shows them.

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
- Every command reads pictures of up to 4096 × 4096 pixels in all
  (16,777,216), and 16384 on a side, for long animation strips. A file whose
  header claims more is refused before it is read (exit 2): scale it down
  first.
- `pixel bake` draws at most 1024 frames (headings times every animation's
  frames), each at most 1024 art pixels on a side, a cylinder has at most
  256 `sides`, and the sheet it writes stays within what the tools read
  back. A model past one is refused (exit 2) before anything is drawn.

### The review page

`ritmo-tools pixel review public/art assets/sprites` opens a game's art on a
local page, where a person goes through it and says what to change. Name the
folders the art is in: a folder is searched for PNGs and text sprites, and a
folder with none, or a path that is not there, exits 2. Left out of a folder:
`node_modules`, hidden folders, and what the tools write beside the art
(`.preview.png`, `.project.png`, `.onion.png`, `@Nx.png` and its JSON,
`.frames/` folders). A fix and what it was made from (`hero.fixed.png` and
`hero.png`; likewise `.sheet.png`, `.pixel.png`, and a sprite's
`.render.png`) show as one row: the file the game uses, with its source
named. A `.txt` file is art only when it reads as a sprite source (others,
notes or prompts, are passed over); named outright, one that does not read
exits 2. A PNG with a JSON beside it in the format `pixel sheet` writes (or
Aseprite's) is a sheet, played by animation with each frame's duration;
with a JSON in a format of its own, it shows as a still.

The list on the left shows every asset under the folder it comes from, with its
status, whether it changed since it was approved, its lint, and its open comments;
the top bar narrows it to what is to review, has changes asked, or is approved. A
file with more than one thing to judge opens into its parts: the **Sprite** of a
still and its **Normal map**, or a sheet's **Animations** and **Normal map**, each
with one row per animation. Each part has its own status, note, comments, and lint, and the file's
status follows: changes asked if any part has them, approved once all are, half
filled while some are. **Approve the rest** approves the parts not judged yet, and
leaves any with changes asked. A click on a file opens its art; only the person
closes a file, so rows never move under the pointer. The art
opens at the largest whole-number zoom that fits, up to 16×, so a small sprite
is big enough to judge and to pin a comment on, and a picture too big for the
stage shrinks to fit, so nothing scrolls until asked; 0 shows it at 1×, the size the
game draws it before any scaling, and a zoom the person picks stays for the
next asset until F fits again. It sits over a backdrop: dark, light, a
checkerboard, or any color.
**Repeat** draws it three by three, to see a tile meet itself. An animation
plays with its durations. The bar at the bottom left holds what the part open
does (it pauses and steps through an animation's frames), and the zoom stays at
the bottom right on every part. **Set** shows every asset at one scale, chosen from the set's typical size, on
a grid by size over one backdrop, to see whether they belong together; a
picture too big for the grid is smaller and says its own zoom. A click on a
tile picks it, and the arrow in its corner opens it; the browser's Back, **Set**, or V
goes back to the same spot on the set. Pick several
and **Compare them** shows only those, or **Approve them** approves what
shows at once: stills only, their art when the set shows art, their normal maps
when it shows them. A sheet's animations and their maps are left for opening,
since a tile shows only the first frame.

Dragging over the art pins a comment to that area of the frame shown (a
click pins it to one pixel), on the part open; each comment's number rings its
area, at every zoom. On the right are the part's review (status and note), its
comments (resolved ones greyed, with the agent's reply, and **Reopen**), the lint against the
asset's nearest `pixel.config.json` (**Show** rings a rule's pixels on its
frame), and the files the asset comes from. **Approved** keeps a hash of
each frame's pixels as decoded and its duration: a re-export that looks the
same is no change, and neither is a color hidden under a transparent pixel.
When the art later looks different or plays at other timings, the page and
`pixel notes` say which frames, on the parts they are in, and **Approve it as it
is now** takes the new version; the status stays approved, since only the person
changes it. A renamed or removed animation leaves its review in `pixel notes`
(`goneParts`), and its comments show on the file's first part. A
`pixel.review.json` from before parts still reads: what it said about a sheet
stands for each animation, until one is reviewed on its own.

Art with a normal map beside it (see "Normal maps") has a sun on its row and
**Normal map** parts: a still has one, and a sheet one for each animation, closed
until opened, since flicker only shows in motion. The bar shows the art **Lit**,
under a light, or the **Normal map** itself; hold **Without map** (or M) for the
same light with no map, so what changes is what the map adds. Under the light,
drag it over the art, or use the **Light** section: **Go round** circles the art,
and **Half-Lambert** lights the same map so the far side keeps its shape. **Set**
shows the whole set in any of these, under one light. Pressing on the art pins a
comment about the map, which can say which way the surface there should face. Its
approval keeps a hash of the art and the map under each frame, so new art, or a
new map, shows as a change only on the animations it touches.

↑ and ↓ move down the list, Shift with them goes to the same kind of part on the next file (a normal map to the next normal map), Enter opens or closes the file, Space plays, ← and → step frames, + and − zoom, 0 goes
back to 1×, F fits each asset again, V switches to the whole set and back, L goes to the same animation's normal map under the light and back, on the same frame, N to the map itself and back, holding M takes the map away, and Ctrl/Cmd+Z undoes.
Every change is saved as it happens, and a comment still being typed is added
when the person moves on (Cancel or Esc drops it). Art the agent rewrites or adds, and
comments it resolves, show up while the page is open; what the person is
typing is kept.

The review is not kept beside the art, which usually sits in a folder that
ships with the game: all of it lives in one `pixel.review.json`, keyed by the
path from there, in the nearest folder above the art with a `package.json`
(or the art's own, when there is none).

Approving on the page is not judging the art in the game: the page shows it
alone at whole-number zooms, and the game shows it among the rest, scaled,
moving, and over its own ground. Look at it in the game at the size it is
drawn too.

### Normal maps

For a game that lights its sprites, and only then: painted shading needs none of
this. A normal map is a second picture, the art's size, where each pixel's color
says which way that pixel faces, so a light can shade it from any side.

```sh
ritmo-tools pixel normals public/art/hero.png    # a still, a sheet (its JSON beside it), or a sprite source
ritmo-tools pixel review public/art              # the person judges it under a light
```

It writes, beside the art, and always by its name, since the review and the
lint find them that way:

- `hero.normal.png`: the map, the same size and layout as the art, with its alpha.
- `hero.normals.json`: the preset, the strength, the corrections, the art's hashes,
  and how the colors read: x to the right, y up (green up, as OpenGL and Godot
  read it), z to the viewer, each channel from 0 to 255 for -1 to 1.
- `hero.lit.png`: a picture to look at. For a still, the art, the map, and the art
  lit from each side. For a sheet, each animation's map and light, and the frame
  where most pixels jump, those pixels in magenta.

The presets say what the art is of: `character` (the default for a sheet),
`object` (for a still), `architecture`, and `terrain`.

**It is an estimate.** Connected pixels of one color form a surface, and each
surface faces the way a height guessed from the silhouette and the brightness
slopes, snapped to 8 directions and 4 tilts so the map stays in flat facets. It
cannot tell painted shading from a dark material. On a ball painted in bands, it
is about 27° off on average, where a flat map is 45° off. So a person looks, and
corrects.

**Correcting.** A comment on the review page can carry a direction. It comes
back through `pixel notes` with its area and its `facing`; copy those into
`corrections` in the `.normals.json` and run `pixel normals` again:

```json
{ "animation": "walk", "frame": 2, "x": 3, "y": 1, "width": 6, "height": 4, "facing": "up-left", "tilt": 30 }
```

A correction picks whole surfaces (those mostly inside its area, or making up a
good part of it) and they turn in every frame of the animation they carry on
through, so a correction made on one frame does not flicker. It stays when the
command runs again. One that does nothing exits 3 and says why.

**Animation.** Made one frame at a time, a map boils: small changes to the
silhouette tip a surface into another direction, on pixels that did not change.
Here a surface that carries on from frame to frame keeps one direction through
its animation. The report's `flicker` gives each animation's share of unchanged
pixels whose light jumps, measured at 4-5% on the worst animation of two
hand-drawn sheets and 19% on an AI-made one, against 11-55% for those sheets one
frame at a time. Past 15% is a `normal-flicker` warning, with **Show** on the page
ringing the pixels.

**The lint.** `pixel lint` on the art, and the review's **Rules**, check its map:
`normal-stale` (the art changed since: run it again), `normal-size`,
`normal-alpha`, `normal-invalid` (not directions), `normal-flicker`, and
`normal-flat` (it adds next to nothing). `pixel lint hero.normal.png` checks the map
against its art rather than the rules for art, which its colors would all
break. A map with no `.normals.json` beside it counts as painted by hand: it
shows and is checked the same, it is never stale, and `pixel normals` only
replaces it with `--force`.

**In the game.** Ritmo draws nothing, so the light is the game's own shader. The
core of one, in GLSL:

```glsl
// uArt, uNormal: the two pictures, nearest-filtered, the normal map with no color conversion.
// vUv: where this pixel is on them. vPos: this pixel, in art pixels, rows counting down.
// uLight: the light, in art pixels, with z its height. uFlip: -1 while the sprite is mirrored, else 1.
vec4 art = texture2D(uArt, vUv);
vec3 normal = texture2D(uNormal, vUv).rgb * 2.0 - 1.0;
normal.x *= uFlip;
vec3 toLight = vec3(uLight.x - vPos.x, vPos.y - uLight.y, uLight.z);
float away = length(toLight);
float diffuse = max(0.0, dot(normal, toLight / away));
// Valve's half-Lambert keeps the far side's shape: float wrapped = 0.5 * dot(normal, toLight / away) + 0.5; diffuse = wrapped * wrapped;
float falloff = 1.0 / (1.0 + (away / uReach) * (away / uReach));
gl_FragColor = vec4(art.rgb * (uAmbient + uLightColor * diffuse * falloff), art.a);
```

Three things go wrong silently. A mirrored sprite needs its normal's x mirrored
too (`uFlip`), and a rotated one its x and y rotated. The map must not be
filtered: a blended normal is no direction. And it must load with no color
conversion, since its colors are numbers (in Pixi, a texture source with
`alphaMode: "no-premultiply-alpha"`). The page's light is a preview of the map's
shape, not of this shader: the final look is judged in the game.

The method comes from [Pixel Art Lighter](https://moonfell-rpg.com/pixel-lighter.html)
by Red Hat Sprite (MIT; its notice is in this package's `LICENSE`). Carrying
surfaces through an animation, corrections as data, and the checks are this
tool's.

### Baking

For a thing with a solid shape: a building, a vehicle, a prop, a turret, above
all one of a set or one seen from several angles. You describe it in 3D, and the
tool draws it through the project's one camera and light, so every sprite shares
the angle, the shading on the palette's ramps, clean edges, and one outline. The
design stays yours: any shapes, any colors, proportions as exaggerated as the
style wants, and hand-placed pixels for what geometry cannot say. What is odd
about a model comes back in the report, never as a refusal.

Not for characters or anything soft. Below about 24 pixels across, a bake loses
what tells things apart: draw those as a sprite source (`pixel render`), from a
bake if that helps.

**The loop.** Write `<name>.bake.json` (by hand, or from a script: a model is
only data), bake it, open `<name>.preview.png`, judge the set in the game at its
display size, and change the model. Every bake rewrites everything but the
model, so an edit to the PNG is lost. To finish a piece by hand, carry on from
its `.sprite.txt` with `pixel render`: it no longer bakes.

```sh
ritmo-tools pixel bake public/art/cottage.bake.json
```

```json
{
  "materials": { "Y": "#ffcd75" },
  "parts": [
    { "name": "walls", "shape": "box", "material": "plaster", "from": [-6, -5, 0], "to": [6, 5, 8] },
    { "name": "roof", "shape": "box", "material": "thatch", "from": [-7, -6, 8], "to": [7, 6, 16], "top": [0, 1] },
    { "name": "door", "shape": "face", "material": "#b13e53", "corners": [[6, -1, 0], [6, 1, 0], [6, 1, 5], [6, -1, 5]] },
    { "name": "chimney", "shape": "box", "material": "stone", "from": [-5, -4, 10], "to": [-2, -1, 20] }
  ],
  "paint": [{ "at": [-3, -22], "rows": [".Y.", "YYY"] }]
}
```

**Axes.** Every number is in the model's units, in the screen's axes as at
`yaw` 0: +x right, +y toward the viewer, +z up. A `yaw` of 45 shows a corner:
+x runs down-right and +y down-left, so a box shows its +x side, its +y side,
and its top. What faces away never shows, and what points at the camera is a dot.

**The project's setup**, `bake` in `pixel.config.json`, is the only place the
camera, the light, and shared materials live: that is what makes models one set.

```json
{
  "palette": "sweetie-16",
  "bake": {
    "camera": { "yaw": 45, "elevation": 30, "scale": 2, "heightScale": 1 },
    "light": { "sun": [-0.7, 0.05, 0.7], "dark": 0, "bright": 0.6, "castShadows": false },
    "outline": "#1a1c2c",
    "edges": 4,
    "materials": {
      "plaster": ["#566c86", "#94b0c2", "#f4f4f4"],
      "thatch": ["#b13e53", "#ef7d57", "#ffcd75"],
      "stone": ["#333c57", "#566c86", "#94b0c2"]
    }
  }
}
```

Every field has that default except `scale` (1), `outline`, and `materials`.

- `camera`: `scale` is art pixels per unit; `elevation` is degrees above the
  ground (30 makes ground 2:1, 90 looks straight down); `heightScale` is for a
  game whose view is not a true projection. A point lands at
  `X = x cos(yaw) - y sin(yaw)`, `Y = x sin(yaw) + y cos(yaw)`, then across
  `X * scale` and down `(Y * sin(elevation) - z * heightScale * cos(elevation)) * scale`.
- `light`: `sun` points toward the sun in the screen's axes whatever the `yaw`
  (`[0.7, 0.05, 0.7]` is the picture's upper right), and stays put as a model
  turns. A ramp's steps fall evenly from `dark` to `bright` on how directly a
  surface faces the sun, from -1 to 1. `castShadows` makes parts darken what they
  shade: lively at large sizes, noisy at small ones.
- `outline`: a color, or `false`. Left out, the palette's darkest.
- `edges`: a surface this many art pixels behind its neighbour goes one step
  darker, which separates parts without a line around each. `false` for never.
- `materials`: one color, or a ramp from dark to light, of any length. Ramps far
  apart keep neighbours apart: at small sizes contrast says more than modelling.

**A model** is `parts`, and all of these are optional:

| Field | What it is |
| --- | --- |
| `materials` | More materials, or this model's own version of one. |
| `headings` | How many directions to draw, as animations named `heading-0` (the view under Axes), `heading-1`, and so on, each turned clockwise by 360 / `headings` degrees. They share one frame around the origin, so put the model's middle on it. |
| `animations` | `{ "spin": { "frames": 6, "fps": 8, "loop": "forward" } }`; `loop` can be `"pingpong"`. With headings too, `spin-heading-0`. |
| `frame` | `{ "width": 34, "up": 24, "below": 10 }`: art pixels around the model's origin. Each one you leave out fits the art. An even width puts the origin on the corner between pixels. |
| `outline` | This model's own, or `false`. |
| `cleanup` | `false` keeps lone pixels. |
| `normals` | `true` writes `<name>.normal.png`, from the real surfaces, to light the art in a game; `pixel review` shows it under a light. |
| `shadow` | `true` writes `<name>.shadow.png`, the model flattened along the sun, for a game to draw under it. |
| `paint` | Hand-placed pixels, below. |

**Parts.** What is nearest the camera shows, as in 3D, so their order does not
matter. Every surface shows from either side, and nothing cuts holes: a pit is
walls around a floor.

| `shape` | Takes |
| --- | --- |
| `box` | `from` and `to`, two opposite corners. `top: [a, b]` scales its top along x and y: `[1, 0]` is a roof with its ridge along x, `[0, 1]` along y, `[0, 0]` a point, `[0.5, 0.5]` a frustum. `lean: [dx, dy]` moves its top. |
| `cylinder` | `from` and `to`, the corners of the box around it. `axis`: `"z"` (default), `"x"`, or `"y"`. `sides` (20; 8 or 10 look faceted). `taper` scales its far end: `0.05` is a cone. |
| `sphere` | `from` and `to`, the corners of the box around it. |
| `face` | `corners`: a flat convex polygon, `[x, y, z]` going around its edge. It shows over a surface it lies exactly on: doors, windows, stripes, trim, or one side of a part in its own material. |
| `mesh` | `points`, and `faces` as lists of positions in `points`. Any shape at all. Each face has to be flat and convex: split one that is not, and the report says which. |

Any part, and any group (`"parts": [...]` in place of `shape`) takes these. A
group's `material`, `detail`, and `step` go to its parts that have none of their
own. A part is animated, turned, then moved, and then its group does the same:

| Field | What it is |
| --- | --- |
| `material` | A color like `"#ef7d57"`, or a material's name. |
| `name` | What the report calls it. |
| `move` | `[x, y, z]`. |
| `rotate` | `{ "axis": "z", "degrees": 90, "about": [0, 0, 0] }`, `about` in the part's own units before its `move`. Positive takes x toward y around z, y toward z around x, and z toward x around y. |
| `repeat` | `{ "count": 8, "move": [2, 0, 0], "rotate": { ... }, "materials": ["#f4f4f4", "#b13e53"] }`: copies, each one step further, taking materials in turn. Stripes, fence posts, windows, spokes. |
| `animate` | `{ "spin": { "rotate": { "axis": "x", "degrees": 90 }, "move": [0, 0, 2], "wave": false } }`: where it gets to at the animation's end, which is never drawn, so a loop closes cleanly. `wave` swings out to it, back through rest, and out the other way: a bob or a sway. |
| `detail` | `true` counts it three times when pixels are decided, and keeps its lone pixels. Under about two pixels it still comes out a lone pixel: paint that instead. |
| `step` | Holds a ramp on one of its steps, 0 the darkest. |

**Paint** is for what geometry cannot say: a flame, a flag, a face, the one
pixel that makes a shape read. It bakes with the model every time.

```json
{ "at": [-3, -22], "rows": [".Y.", "YYY"], "animation": "spin", "frames": [0, 2], "headings": [0] }
```

Only `at` and `rows` are needed. `at` is art pixels from the model's origin to
the first row's first pixel, x right and y down: the report's `frame.anchor` is
the origin in the PNG, so the PNG's pixel at column `c` and row `r` is
`[c - anchor.x, r - anchor.y]`. Each letter names a one-color material; `.`
leaves what is there, and `_` clears it. The outline goes around paint;
`"after": true` puts it over the outline instead.

**What it writes, and the report.** `<name>.png`, `<name>.preview.png`, and for a
still `<name>.sprite.txt`. Several frames make a sheet instead: `<name>.json` in
the format `pixel sheet` writes (each frame's `anchor` is the model's origin, and
each animation starts a new row), with a `<name>.<animation>.gif` and
`.onion.png` for each animation that moves. What an earlier bake wrote that
this one does not (a still's text once it is a sheet, a gone animation's GIF) is
removed and listed in `files.removed`. `issues` holds the project's rules
on every frame (`stray-pixel` with its positions in `at`, and `frame` on a
sheet), and two of its own: `bake-cut`, an error (exit 3), when an explicit
`frame` cuts the art; and `bake-hidden`, a warning, for a part with no pixel in
any frame. Warnings exit 0, so read `issues` every time. Exit 2 lists every
`problems` entry in the model at once, each with its `path` and what to do.

### Code

- `src/pixel/core/`: the headless core, tested in `test/` with fake AI pictures made
  from known sprites (`pnpm test` from the repository root runs them).
  `color.ts` (OKLab, CIELAB, CIEDE2000, nearest color), `grid.ts` (detection,
  following and bending lines), `outline.ts` (one-pixel outlines), `fix.ts`
  (reading cells, quantizing, dithering),
  `cleanup.ts` (specks), `palette.ts` (presets, files, extraction, proposals), `reduce.ts`
  (fewer, bigger pixels), `background.ts` (background removal), `lost.ts`
  (colors the palette lost), `normals.ts` (normal maps, the preview's light, and flicker),
  `export.ts` (PNG pixels,
  SVG, JSON), `demo.ts` (the fake AI picture generator),
  `pipeline.ts` (the whole fix, from a picture and a recipe: what the page and
  the CLI both run), `recipe.ts` (recipes as JSON), `project.ts` (project
  PNGs: the recipe in a PNG text chunk), `sprite.ts` (sprite
  sources), `lint.ts` (the rules), `report.ts` (the check and its verdict),
  `preview.ts` (pictures to look at), `sheet.ts` (clearing a sheet, finding
  its frames, anchors, and laying frames on one canvas), `animation.ts` (the
  whole fix for a sheet), `spritesheet.ts` (sheet layouts and their JSON),
  `bake.ts` (models of 3D shapes, and drawing them), `gif.ts` (animated GIFs), `zip.ts` (stored ZIP files), `review.ts` (the
  review file, approval hashes, and the notes). The outline
  handling, bent lines, and the outline-keeping shrink follow
  [ToPixel](https://github.com/daisuqe/ToPixel).
- `src/pixel/ui/`: the page (plain DOM and a canvas, no framework; `player.ts` plays
  animations), exported as
  `@typeonce/ritmo-tools/pixel/page` and `/pixel/page.css` inside the repository
  for the website to mount on `#app` (the published package ships the CLI only).
- `src/pixel/cli/`: the `pixel` command (Effect), with PNG files through `pngjs` and
  JPEG through `jpeg-js`;
  `src/cli.ts` is `ritmo-tools` itself, and `bin/ritmo-tools.mjs` runs it from
  its TypeScript source inside the repository. `library.ts` finds a game's art,
  reads, hashes, and lints each asset, and keeps the review file; `serve.ts` is
  the review page's server.
- `src/pixel/review/`: the review page (`lab.ts`), which only draws what the
  server decoded, and the store it reads and writes through (`store.ts`).

## Effects lab (`ritmo-tools fx`)

Pixel art effects (hits, explosions, fire, magic) as code, for agents and the
people they make games with. Code is easy to vary and tune, so an effect is a
few drafts, each a small JavaScript module; the agent writes and checks
them, and a person watches them side by side on a local page, picks one,
tunes it with sliders, and says what to change. One runner draws the frames
everywhere, so what the person watches, what the agent checks, and the sprite
sheet the game plays are the same pixels.

The checks measure pixel art craft (jaggies, doubles, pinholes, flicker,
contrast on the game's own backgrounds) and the project's
`pixel.config.json`, and say on which frames and pixels; the person can
click a pixel to pin a comment to it, and the agent sees that pixel ringed.

### Drafts and banks

A draft is a module with no imports whose default export says the effect's
size, frame count, speed, and tunable params, and draws one frame:

```js
export default {
  label: "starburst",
  size: [24, 24], // pixels, up to 256 × 256
  frames: 8,
  fps: 24,
  loop: false, // true: plays again from the start (a torch); false: plays once and should end empty (a hit)
  anchor: [12, 12], // the pixel the game places on the effect's spot (where the blow lands); the middle by default
  params: { rays: { min: 3, max: 10, value: 7, step: 1 }, reach: { min: 5, max: 11, value: 10 } },
  draw(fx) {
    if (fx.frame === 0) fx.disc(fx.cx, fx.cy, 3, "white")
    for (let i = 0; i < fx.p.rays; i++) {
      const angle = (i / fx.p.rays) * Math.PI * 2 + fx.range(-0.35, 0.35)
      const far = fx.ease.out(fx.t) * fx.p.reach
      const near = fx.ease.in(fx.t) * fx.p.reach
      const color = fx.ramp("fire", fx.t) // the bank's "fire" ramp
      fx.line(fx.cx + Math.cos(angle) * near, fx.cy + Math.sin(angle) * near, fx.cx + Math.cos(angle) * far, fx.cy + Math.sin(angle) * far, color)
    }
  }
}
```

Drafts are code, and every `fx` command that reads a bank runs them (with
Node's full permissions in the CLI, in the browser on the page): run it on
banks you trust, as you would `npm run` in a project. In the CLI, one
frame's `draw` that runs past 5 seconds is stopped: "draw did not return
within 5 s on frame F" is an error (`fx check`, `fx look`, and `fx render`
exit 3), and
the frames after it are not drawn. It catches a loop that never ends; it is
not a sandbox.

`draw(fx)` runs once per frame, from nothing: an effect is a function of
time, not a simulation. It gets:

| `fx.` | What it is |
| --- | --- |
| `frame`, `frames`, `t` | This frame's number, how many there are, and how far through it is: 0 on the first frame, 1 on the last (a loop never reaches 1, so its last frame leads back to its first). |
| `w`, `h`, `cx`, `cy` | The canvas's size and its middle pixel. |
| `p` | The params, with the person's tune laid over them. |
| `random()`, `range(min, max)` | Numbers from the draft's seed. They start over on every frame, so the n-th number is the same in every frame: draw the n-th particle's direction and speed from it, and its place from `t`. |
| `px`, `rect`, `line`, `disc`, `ring` | Draw with a palette color's name. Coordinates are rounded down to whole pixels; later shapes cover earlier ones. Circles are drawn as pixel artists draw them: the midpoint circle at the radius rounded to a whole pixel, with no doubles, its steps even; a disc fills the same outline, and `ring(x, y, r, color, width)` thickens inward with no pinholes. A radius of 0 or less draws nothing. |
| `oval(x, y, rx, ry, color)`, `ovalRing(x, y, rx, ry, color, width)` | The same for ellipses: a pool, a scorch, or a shock ring lying flat on the floor. |
| `sparkle(x, y, arm, color, tip)` | A star glint: a pixel with four arms `arm` long, their ends in `tip` (default `color`). |
| `streak(x, y, dx, dy, ramp)` | A moving spark's trail: a line from its head back by `(dx, dy)` (its motion), colored along a ramp from head to tail. |
| `ramp(ramp, v)` | The color at `v` (0 to 1) along one of the bank's ramps by name (`"fire"`), or a list of colors: hot to cold, bright to dark. Name the bank's, so the draft recolors with it. |
| `ease.in`, `ease.out`, `ease.inOut`, `lerp`, `clamp` | Curves and helpers for timing. |

A bank is one file per game naming:

- the palette;
- `ramps` (optional): fades through palette colors by name, hot to cold, that drafts draw with (`fx.ramp("fire", v)`);
- the game's own backgrounds (`backdrops`, optional: the contrast check and the page use them);
- a stand-in (`standIn`, optional): a PNG of one of the game's sprites, `anchor` at its feet, drawn behind every effect on the page and in `fx look` so its size reads against a body. It stands on the effect's anchor, moved by the effect's `standIn` offset (`[0, 24]`: a hit's target stands 24 pixels below where the blow lands), or not at all with `false`;
- each effect's drafts (paths from the bank's folder, inside it: no absolute path and no `..`, for drafts and the stand-in alike), with each draft's `seed`, `tune`, `recolor` (a ramp drawn as another: `{"fire": "frost"}` is a recolored copy with no new code), and `accept` (warnings judged deliberate, each with why: `fx check` lists them apart and does not count them; errors cannot be accepted), and the draft the game gets in `use` (the first when unset):

```json
{
  "version": 1,
  "palette": { "white": "#ffffff", "yellow": "#fee761", "orange": "#f77622", "red": "#e43b44", "cyan": "#2ce8f5", "blue": "#0099db" },
  "ramps": { "fire": ["white", "yellow", "orange", "red"], "frost": ["white", "cyan", "blue"] },
  "backdrops": { "dungeon": "#1a1c2c", "meadow": "#5a8f3c" },
  "standIn": { "file": "art/hero.png", "anchor": [10, 45] },
  "effects": {
    "hit": {
      "about": "A sword blow lands on an enemy.",
      "standIn": [0, 24],
      "drafts": {
        "a": { "file": "fx/hit.a.js" },
        "b": { "file": "fx/hit.b.js", "seed": 3, "tune": { "reach": 8 }, "accept": { "jaggies": "the notches where the sparks overlap are the look" } },
        "c": { "file": "fx/hit.b.js", "recolor": { "fire": "frost" } }
      },
      "use": "b"
    }
  }
}
```

Its review lives next to it (`game.fx.json` → `game.fx.review.json`): each
effect's status (`new`, `approved`, `changes`), the person's note, and their
comments, each pinned to a draft, a frame (from 0, as `fx.frame`), and a
pixel, and resolved by the agent with a reply (`fx resolve`). Once approved,
it keeps everything `fx render` hands the game: the draft, a hash of each
frame, the fps, whether it loops, the canvas size, and the anchor. `examples/fx/effects.fx.json` in the repository is a hit, a heavy
slash, an ice spike, an explosion, a torch (one draft of it recolored), and a
heavy landing, with two to four drafts each and a character's silhouette as the stand-in.

### The checks

`fx check` runs each draft twice, and with seeds 2, 3, and 7 to see how far
it can reach. **Errors** (exit 3): a module that does not load or throws, a
color or ramp the bank does not have, nothing drawn,
randomness that is not the seed's, and against the project's
`pixel.config.json` (the nearest at or above the bank's folder, or
`--config`): a bank color outside its palette, or a draft with more colors
than its `maxColors`. **Warnings**, each with the frames, and for the craft
rules up to 8 pixels in `at`:

| Code | What it finds |
| --- | --- |
| `clipped` | Pixels drawn past the canvas edge. |
| `clipped-seed` | Kept inside by the draft's seed alone: another seed draws past the edge, so a new seed cuts it off. |
| `late`, `no-end`, `tail` | A one-shot that starts after frame 0, does not end empty, or ends on more than one empty frame. |
| `seam` | A loop that jumps from its last frame back to its first. |
| `gap` | Empty frames in the middle. |
| `noise`, `full` | Mostly lone pixels; one frame covering most of the canvas. |
| `jaggies` | Uneven steps along an edge: a run of pixels at least 2 shorter or longer than both runs beside it (3, 1, 3). Steady rhythms (2, 1, 2, 1) pass. From 3 spots in a draft. |
| `doubles` | The corner pixel of an L in a one-pixel line, in shapes of 5 pixels or more. From 3 spots. |
| `holes` | Single empty pixels with drawn pixels on all four sides. From 3 spots. |
| `flicker` | Pixels that change for one frame and change back, above 6% of drawn pixels: in motion it boils. |
| `contrast` | More than half the drawn pixels barely differ (OKLab, under 0.12) from one of the bank's `backdrops`. |
| `near-duplicate-colors` | Palette colors too close to tell apart. |

`fx look --marks <code>` rings where a craft rule breaks, in magenta.

### The command line

`npx @typeonce/ritmo-tools fx <command>` (inside the Ritmo repository, `node packages/tools/bin/ritmo-tools.mjs fx <command>`).
Every command prints JSON and exits 0 (clean), 2 (usage error, missing
file, broken bank), or 3 (a draft has errors).

| Command | Does |
| --- | --- |
| `ritmo-tools fx init [bank]` | Writes a starting bank (a six-color palette and a fire ramp) and one draft of a hit spark. |
| `ritmo-tools fx check <bank> [names...] [--config file]` | Runs every draft twice and measures it (frames, length, the box it fills, its colors), and lists errors and warnings (see above), with accepted warnings apart. |
| `ritmo-tools fx look <bank> <name> [--draft a] [--scale 6] [--columns 8] [--backdrop dark] [--marks comments] [--compare] [--alone]` | Writes a contact sheet PNG per draft: every frame side by side, enlarged, on a backdrop (`dark`, `light`, `checker`, or one of the bank's by name), with the bank's stand-in behind it (`--alone` leaves it out), for the agent to look at. `--marks` rings the person's comments (the default) or where a craft rule breaks (`jaggies`, `doubles`, `holes`, `flicker`), and the report lists them. `--compare` writes one picture instead: a row per draft, each column the same moment (`--columns` of them, first frame to last), to weigh the drafts against each other. |
| `ritmo-tools fx render <bank> [names...] [-o dir] [--scale 1]` | Writes each effect's draft in use as a sprite sheet PNG (its frames in rows of up to 8), its JSON (the hash format Pixi, Phaser, and Aseprite read: each frame's rectangle, duration, and anchor from the draft's `anchor`, the animation and its fps, and `meta.loop`, whether it loops or plays once), and a GIF. An effect that differs from what the person approved lists `changedSinceApproved`. |
| `ritmo-tools fx review <bank> [--port 5192] [--host] [--config file]` | Serves the review page and prints its address; runs until stopped. |
| `ritmo-tools fx notes <bank>` | What the person said: each effect's status, note, open comments (numbered, with draft, frame, pixel, and text), how many are resolved, draft in use, tune, and `changedSinceApproved` when an approved effect no longer matches what the person saw (its draft, frames, fps, loop, canvas size, or anchor), or `unrecorded` (also for an approval from before approvals kept the loop and anchor), changes asked first; `gone`, what was said about effects the bank no longer has; and the bank's palette and ramps as they are now. |
| `ritmo-tools fx resolve <bank> <effect> <numbers...> [--reply "what changed"]` | Marks comments as resolved: `fx notes` and `fx look` stop showing them, and the page shows them done with the reply. The person can reopen one. |

### The review page

`ritmo-tools fx review` opens the bank on a local page: the effects on the
left with their status, every draft of the selected one playing side by side
on one clock (one-shots rest a moment between plays), and on the right its
review (status, note, and comments), the tune sliders of the draft in focus,
and that draft's check, with the accepted warnings and their reasons. Every
card is the size of the effect's largest draft, so nothing moves as they
play. The playback bar pauses, steps frame by frame (the same frame on every
draft), slows to ½ or ¼, and zooms from 1× to 8×; the Background section
picks what the drafts play over (the bank's `backdrops` first, then neutral
ones) and shows or hides the stand-in. The tune section also lists the bank
ramps the draft draws with, each drawn as itself or as another ramp: picking
one saves the draft's `recolor`. The Palette section edits the bank's colors
(from the project's `pixel.config.json` palette when it has one, so effects
keep to the sprites' colors) and its ramps (pick, reorder, add, and remove
steps; add a ramp; delete one no draft draws with), for every effect at once. Clicking a draft focuses it; clicking a pixel of the
draft in focus pauses on that frame and pins a comment to it; a comment's number rings its pixel on its frame, and clicking the
comment goes there. **Show** on a check pauses on its frame with its pixels
ringed. Resolved comments show greyed, with the agent's reply, and
**Reopen** puts one back on its list. **Use** picks the draft the game gets. **Approved** keeps what the person saw:
when the draft in use, its frames, or its fps later differ, the page says so and
**Approve it as it is now** takes the new version. Space plays, ← and → step, ↑
and ↓ change effect, 1 to 9 focus a draft, and Escape clears rings. Every
change is written to the bank and its review as it happens, and a draft the
agent edits while the page is open plays anew.

The website hosts the same page with the example bank, kept in the tab, to
try without the CLI: https://ritmo.typeonce.dev/tools/fx/.

### Code

- `src/fx/core/`: the runner and what `draw` gets (`effect.ts`), banks and
  reviews (`bank.ts`), the checks (`check.ts`) and the craft rules they use
  (`craft.ts`), and frames as pixel art and
  contact sheets (`export.ts`, through the pixel fixer's sheet and GIF
  writers).
- `src/fx/cli/`: the commands, loading drafts as `data:` URLs (`io.ts`),
  and the page's server (`serve.ts`).
- `src/fx/ui/`: the review page, which loads drafts as `blob:` URLs, and the
  website's demo of it (`demo.ts`, `example.ts`).

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
(`new`, `approved`, `changes`), the person's note, the takes offered, and,
once approved, what the person heard: a hash of the recipe (not its `about`,
`heavy`, or `interval`) and the bank's master volume.
`examples/spirit-call.sounds.json` in the repository is Spirit call's 46 sounds.

### The command line

`npx @typeonce/ritmo-tools sound <command>` (inside the Ritmo repository, `node packages/tools/bin/ritmo-tools.mjs sound <command>`).
Every command prints JSON and exits 0 (clean), 2 (usage error, missing
file, broken bank), or 3 (a sound has errors).

| Command | Does |
| --- | --- |
| `ritmo-tools sound init [bank]` | Writes a starting bank of three sounds. |
| `ritmo-tools sound check <bank> [names...]` | Measures each sound (length, peak, loudness, attack, brightness, ending) and lists what breaks the rules: clipping, silence, a late start, a click at the end, much louder or quieter than its kind. |
| `ritmo-tools sound render <bank> [names...] [-o dir] [--sequence 0.25]` | Writes WAV files, and with `--sequence` the sounds in a row. A sound that differs from what the person approved is listed in `changedSinceApproved`. |
| `ritmo-tools sound vary <bank> <name> --toward heavier [--count 4] [--seed 1]` | Makes takes nudged one way (`heavier`, `lighter`, `brighter`, `darker`, `punchier`, `softer`, `shorter`, `longer`, or `wider` for anything) and offers them in the review. |
| `ritmo-tools sound review <bank> [--port 5190] [--host]` | Serves the review page and prints its address; runs until stopped. |
| `ritmo-tools sound notes <bank>` | What the person said: status and note for each sound, changes asked first, `changedSinceApproved` for an approved sound that no longer matches what the person heard (or `unrecorded`), and `gone`, what was said about sounds the bank no longer has. |

### The review page

`ritmo-tools sound review` opens the bank on a local page: the sounds on the left with
their status, the selected sound's wave and layers on the stage with the
takes beside each other, and on the right its review, its check, the takes
maker, tune sliders, and the layers' numbers (takes and layers start closed).
Space plays, the arrows move through the list, 1 to 9 play the takes, and
Ctrl/Cmd+Z undoes. Every change is written to the bank and its review as it
happens, and changes the agent writes while the page is open show up in it.
**Approved** keeps what the person heard: when the sound later differs, by
anyone's hand, the page says so, and **Approve it as it is now** takes the new
version. The status stays approved: only the person changes it. `--host` serves
it on the network too, to listen on a phone.

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
`approved`, `changes`), a note, comments pinned to bars (and a track),
the person's edits since the agent last wrote the song, a line each, and, once
approved, what the person heard: a hash of what the song shares and of each
track, without the words (`about`, track names), the key's name, or the
reference.

Music that is not a song (a plain `.wav`, `.flac`, `.mp3`, `.ogg`, or `.m4a`)
is reviewed as it is. It often sits in a folder that ships with the game
(`public/`), so its review is not kept beside it: all of them live in one
`music.review.json`, by path, in the nearest folder above the file with a
`package.json` (or the file's own, when there is none): the status, a note,
comments on a stretch of seconds, and a hash of the file once approved.
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
| `ritmo-tools music render <song> [-o file.wav] [--stems]` | Writes the song as a stereo WAV and a MIDI file, and with `--stems` each track alone. `changedSinceApproved` says when the song differs from what the person approved. |
| `ritmo-tools music review <paths...> [--port 5191] [--host]` | Serves the review page for the songs, audio files, and folders named, and prints its address; runs until stopped. |
| `ritmo-tools music notes <paths...>` | What the person said about the same paths: a `summary` of what is left, then `music`, each piece's status, note, comments (with their bars and tracks, or their times), edits, `changedSinceApproved` (or `unrecorded`), and `next`, changes asked first; `gone` lists reviews whose music is no longer found (a song's review with no song beside it, a plain file's in `music.review.json`). |

A folder is searched for `*.song.json` and audio files. Name the folders the
game's music is in rather than the whole game, which holds much that is not
music. Left out of a folder: `node_modules`, hidden folders, `.stems` folders,
`.reference.wav` files, and the render of a song beside it (`theme.song.wav`
next to `theme.song.json`). A file named outright is always taken.

### The review page

`ritmo-tools music review` opens the music on a local page. With more than one
piece, the list on the left shows each with its status, by folder, and the top
bar narrows it to what is to review, has changes asked, or is approved; the
arrows move through it, and what the person has not saved yet is written before
another piece opens. **Approved** keeps what the person heard: when the piece
later differs, by anyone's hand, the page and the list say so, and **Approve it
as it is now** takes the new version. The status stays approved: only the person
changes it. A song the agent adds, or a song that does not read, shows up on the
list.

A song shows the reference and
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

A plain audio file shows its wave, its length, loudness, and peak, and the
review. Space plays and pauses, the loop button chooses whether it plays around
or once, and **Hear the loop point** plays its end into its start, where a seam
shows. A click on the wave puts the start marker there (while playing, jumps
there), and dragging across it picks a stretch to comment on.

The website hosts the same page with the village song and its hum, kept in
the tab, to try without the CLI: https://ritmo.typeonce.dev/tools/music/.

### Code

- `src/music/core/`: songs (`song.ts`), the instruments (`instruments.ts`),
  the renderer (`render.ts`), listening (`listen.ts`), checks (`check.ts`),
  reviews and edits in words (`review.ts`), WAV (`audio.ts`) and MIDI
  (`midi.ts`) files. Plain TypeScript that runs the same in Node and the
  browser.
- `src/music/cli/`: the `music` command (Effect), what music the paths hold
  (`library.ts`), and the review page's server (`serve.ts`).
- `src/music/ui/`: the review page (`lab.ts`): the canvases (`grid.ts`), a plain
  audio file (`audio.ts`), the review and comments panels (`panels.ts`), the
  check away from the page (`check.worker.ts`),
  playing (`player.ts`), recording (`record.ts`), reading and writing
  through a store (`store.ts`): the CLI's server (`main.ts`), or the tab for
  the website's demo (`demo.ts`). The published package carries it
  built (`dist/music/page`, made by `prepack`); inside the repository Vite
  serves it from source.
