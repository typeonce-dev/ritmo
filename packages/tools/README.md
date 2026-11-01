# @typeonce/ritmo-tools

Asset tools for games made with [Ritmo](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md),
run by agents from the command line. One command, `ritmo-tools`, with one
tool per kind of asset:

| Tool | For |
| --- | --- |
| `ritmo-tools pixel` | Pixel art: fixes AI-made or blurry pictures and animation sheets onto a true pixel grid and a palette, renders sprites drawn as text, and checks a project's art against its rules. |
| `ritmo-tools sound` | Sound effects: keeps them as JSON recipes, measures and varies them, writes WAV files, and opens a local page where a person listens, picks, tunes, and notes. |
| `ritmo-tools fx` | Pixel art effects: keeps each effect as a few drafts written as code, checks them for pixel art craft and the project's rules, draws contact sheets an agent can look at, writes sprite sheets and GIFs, and opens a local page where a person watches the drafts side by side, picks, tunes, and pins comments to a pixel. |
| `ritmo-tools music` | Game music: hears a person's hum for its tune, tempo, and key, keeps songs as JSON tracks of notes, checks them, writes WAV and MIDI files, and opens a local page where a person plays, edits notes, records, and comments. |
| `ritmo-tools rig` | Characters animated on a skeleton: keeps a character as a rig module (bones, parts drawn as shapes or cut from a parts sheet as pictures, IK chains, props, stances) and each clip as a few drafts written as code, checks the motion (feet that slide or float, limbs out of reach, locked or overbent joints, pops in speed, loops that jump, starts off the stance), draws contact sheets an agent can look at, bakes sprite sheets, GIFs, and a sidecar of each frame's hit segments, sockets, and foot contacts for gameplay, and opens a local page where a person watches the drafts side by side, picks, tunes, pins comments to a spot or a span of frames, and drags a picture's pivot. |

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
banks you trust, as you would `npm run` in a project.

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
- each effect's drafts (paths from the bank's folder), with each draft's `seed`, `tune`, `recolor` (a ramp drawn as another: `{"fire": "frost"}` is a recolored copy with no new code), and `accept` (warnings judged deliberate, each with why: `fx check` lists them apart and does not count them; errors cannot be accepted), and the draft the game gets in `use` (the first when unset):

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
pixel, and resolved by the agent with a reply (`fx resolve`). `examples/fx/effects.fx.json` in the repository is a hit, a heavy
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
| `ritmo-tools fx render <bank> [names...] [-o dir] [--scale 1]` | Writes each effect's draft in use as a sprite sheet PNG (its frames in one row), its JSON (the hash format Pixi, Phaser, and Aseprite read: each frame's rectangle, duration, and anchor from the draft's `anchor`, the animation and its fps, and `meta.loop`, whether it loops or plays once), and a GIF. |
| `ritmo-tools fx review <bank> [--port 5192] [--host] [--config file]` | Serves the review page and prints its address; runs until stopped. |
| `ritmo-tools fx notes <bank>` | What the person said: each effect's status, note, open comments (numbered, with draft, frame, pixel, and text), how many are resolved, draft in use, and tune, changes asked first; and the bank's palette and ramps as they are now. |
| `ritmo-tools fx resolve <bank> <effect> <numbers...> [--reply "what changed"]` | Marks comments as resolved: `fx notes` and `fx look` stop showing them, and the page shows them done with the reply. The person can reopen one. |

### The review page

`ritmo-tools fx review` opens the bank on a local page: the effects on the
left with their status, every draft of the selected one playing side by side
on one clock (one-shots rest a moment between plays), and on the right its
review (status, note, and comments), the tune sliders of the draft in focus,
and that draft's check, with the accepted warnings and their reasons. Every
card is the size of the effect's largest draft, so nothing moves as they
play. The playback bar pauses, steps frame by frame (the same frame on every
draft), slows to ½ or ¼, and zooms from 2× to 8×; the Background section
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
**Reopen** puts one back on its list. **Use** picks the draft the game gets. Space plays, ← and → step, ↑
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

## Skeleton lab (`ritmo-tools rig`)

Characters animated on a skeleton, as code, for agents. A character is a
rig module (its bones, the shapes drawn on them, its IK chains, its props,
and the stances its clips start and end on) and a module per draft of
each clip (an idle, a walk, an attack) that poses the rig on every frame.
The agent writes and checks them, looks at the frames as contact sheets,
and bakes the drafts the game uses into sprite sheets. One runner poses and
draws the frames everywhere, so what the agent checks and what the game
plays are the same pixels.

The checks measure what an agent cannot see by reading a pose: parts cut
off by the frame or under the floor, planted feet that slide or float,
limbs that cannot reach their goal, joints that never bend or bend the
wrong way, sudden changes of speed, loops that jump, a start or end off
the clip's stance. Each names its frames and the bones or parts, and the
report carries the numbers to judge timing by: every joint's bend, the
trail bone's spacing, speed, and arc, and, asked for, where any bone is on
every frame.

### Rigs and clips

A rig module's default export is the character in its setup pose
(standing straight, arms hanging), seen from the side. Coordinates have y
up and the origin on the ground under the character; angles are degrees,
counter-clockwise, 0 pointing along +x:

```js
export default {
  size: [128, 120], // the frame, in pixels
  anchor: [60, 112], // the pixel the ground under the character sits on
  outline: "#16121d", // every part's outline, unless the part says
  line: 1.5,
  back: "torso", // the bone the back runs along, for the peek check
  bones: {
    hips: { y: 38, rotation: 90, length: 6 }, // x and y in its parent's frame; rotation from its parent's direction
    torso: { parent: "hips", length: 26 },
    arm: { parent: "torso", x: 24, rotation: 180, length: 12 },
    fore: { parent: "arm", x: 12, length: 11 },
    sword: { parent: "fore", x: 11, rotation: 90, length: 30 },
    thigh: { parent: "hips", rotation: 180, length: 18 },
    shin: { parent: "thigh", x: 18, length: 18 },
    foot: { parent: "shin", x: 18, rotation: 90, length: 7 }
  },
  parts: {
    thigh: { bone: "thigh", z: 1, fill: "#4b4f6e", shape: { kind: "capsule", r: 4, r2: 3 } }, // a capsule with no ends runs along its bone
    shin: { bone: "shin", z: 2, fill: "#4b4f6e", shape: { kind: "capsule", r: 3, r2: 2.5 } },
    foot: { bone: "foot", z: 3, fill: "#6e4b3a", shape: { kind: "capsule", r: 2 } },
    torso: { bone: "torso", z: 10, fill: "#3f7fb8", shape: { kind: "capsule", r: 6 } },
    head: { bone: "torso", z: 11, fill: "#f1c09a", shape: { kind: "ellipse", c: [1, 72], rx: 6.5, ry: 7 } }, // in world coordinates, standing
    smear: { bone: "sword", z: 19, fill: "#e9f6ffa6", outline: null, hidden: true, shape: { kind: "sweep", from: 8, to: 30, frames: 1 } },
    arm: { bone: "arm", z: 20, fill: "#3f7fb8", shape: { kind: "capsule", r: 3, r2: 2.6 } },
    fore: { bone: "fore", z: 21, fill: "#f1c09a", shape: { kind: "capsule", r: 2.4, r2: 2 } },
    blade: { bone: "sword", z: 22, fill: "#dde6ee", shape: { kind: "poly", points: [{ along: 3, across: -1.5 }, { along: 30 }, { along: 3, across: 1.5 }] } } // points on the bone
  },
  chains: { leg: { upper: "thigh", lower: "shin", end: "foot", bend: 1, foot: true } },
  props: { sword: ["blade", "smear"] },
  // The pose a clip with `stance: "ready"` starts from on frame 0.
  stances: { ready: { bones: { hips: { x: 0, y: -3 }, torso: -6, arm: 40, fore: 60 }, aim: { sword: 50 }, reach: { leg: { x: 4, y: 2 } } } }
}
```

- `bones`: a tree, each with a `length`, a `parent` (none for the root), where it starts in its parent's frame (`x` along the parent, `y` across it), its `rotation` from the parent's direction, and `scaleX`/`scaleY`. Parents are solved before children, in the order the bones are declared otherwise.
- `parts`: what is drawn, each on a `bone`, in draw order `z` (higher over lower; equal keeps the declared order), with a `fill` (`#rrggbb` or `#rrggbbaa`), an `outline` (or `null`) and `line` width, `far: true` for the far side of the body (the peek check watches it), `hidden: true` for a part a pose shows only when it says (a smear), `alt`, other shapes by name, and `tint` (a `#rrggbb` every color it draws is multiplied by: a far side darker and cooler). Parts are drawn anti-aliased. A part whose shapes are all pictures needs no `fill` and has no outline.
- Shapes are drawn in the setup pose's world coordinates, and follow their bone from there: `capsule` (`a`, `b`, radius `r` tapering to `r2`; along the bone when `a` and `b` are left out), `ellipse` (`c`, `rx`, `ry`, `angle`; a circle when `ry` is left out), `poly` (`points`, corners rounded by `round`), `sweep` (the area the bone's segment from `from` to `to` swept over the last `frames` frames: a smear worked out from the clip's own poses), and `image` (a picture: `{ kind: "image", file: "parts/forearm.png", pivot: [x, y], at, angle, scale }`, its `pivot` pixel, in the picture's own pixels from its top left, on the point `at` of the setup pose (the bone's start by default), turned `angle` degrees and drawn `scale` world units a pixel (1 by default); it turns and scales with its bone, sampled bilinearly and composited premultiplied, the same bytes every time). Shapes and pictures mix freely in a rig, and props and slots work the same on both. A point is `[x, y]`, or a point on a bone in the setup pose, `{ bone, along, across, dx, dy }` (the part's own bone when `bone` is left out; `across` is to the bone's left, `dx` and `dy` in world axes), so a shape that hangs on a bone is written along it.
- `chains`: two-bone IK, `upper` then `lower` (which starts at the end of `upper`), ending in `end`; `bend` says which way the middle joint bends (1 counter-clockwise from the line to the goal: a knee facing +x); `foot: true` marks a foot, whose ground contact the checks measure.
- `props`: groups of parts shown, swapped, or hidden as one (a sword, a shield). A prop's parts cannot be hidden one by one.
- `stances`: named poses clips start and end on, so the game can blend between them.
- `sockets` (optional): named points on bones the bake reports on every frame (`{ tip: { bone: "sword", along: 64 } }`), for the game to place a spark or a swapped weapon on (see the sidecar below).
- `look` (optional): the `background`, `ground` line, and `floor` pictures are drawn on; `facing` (optional): `"right"` (the default) or `"left"`.

A clip draft's default export says the clip's length and speed, and poses the rig on each frame:

```js
export default {
  label: "overhead chop",
  frames: 16,
  fps: 24,
  loop: false, // true: plays again from the start (an idle, a walk); false: plays once
  stance: "ready", // frame 0 (and, played once, the last frame) must be the rig's ready stance
  params: { lean: { min: 5, max: 30, value: 18 } }, // tunable: `p.lean` in pose
  phases: [{ name: "swing", from: 7, to: 10, fast: true }], // named spans the checks and the person read; fast ones may snap
  trail: "sword", // the bone whose tip the checks measure for speed and arc
  pose(rig, t, p) {
    const ready = rig.stances.ready
    // Frame 0 is the ready stance: every channel starts from it.
    return rig.keys([
      // Cocked behind the head, and held: the blade at 190°.
      { at: 6, rest: true, bones: { hips: { x: -3, y: -5 }, torso: 10, arm: 200, fore: 30 }, aim: { sword: 190 } },
      { at: 8, curve: "linear", slots: { smear: "default" }, bones: { hips: { x: 1, y: -5 }, torso: -p.lean, arm: 130, fore: 10 }, aim: { sword: 80 } },
      { at: 9, curve: "linear", bones: { hips: { x: 3, y: -6 }, torso: -p.lean, arm: 80, fore: 5 }, aim: { sword: -10 } },
      { at: 10, slots: { smear: null } },
      { at: 15, ...ready }
    ])
  }
}
```

A clip may also name `sockets` of its own (over the rig's) and its `hit`:
the segment the bake reports for gameplay, by default the trail bone's
whole length on its `fast` frames (`hit: { from: 6, radius: 3 }` for the blade alone, 3 wide each side,
`hit: { bone, frames: [[9, 12]] }` for other frames, `hit: false` for a clip
that hits nothing). See the sidecar below.

Drafts and rigs are code, and every `rig` command that reads a bank runs
them with Node's full permissions: run it on banks you trust, as you would
`npm run` in a project. They are ES modules that import nothing but each
other: a clip may import the rig module's named exports and other clips
(shared stances, goals, and constants: `import { GRIP } from "../hero.js"`).
`.mjs` loads anywhere, `.js` in a package whose `package.json` says
`"type": "module"`, and `.ts` with Node 22.18 or newer.

`pose(rig, t, p)` runs once per frame, from nothing: a clip is a function
of time. `t` is how far through the clip the frame is (0 on the first, 1 on
the last; a loop never reaches 1), `p` the params with the person's tune
laid over them, and `rig`:

| `rig.` | What it is |
| --- | --- |
| `keys(list)` | The pose a list of keys gives on this frame: the one way to key a clip (see below). |
| `add(base, over)` | `over` laid on `base`, for a pose made of layers (breathing on a stance): turns, moves, and aim angles add up; goals, slots, props, and draw order in `over` win. |
| `stances` | The rig's stances by name. |
| `frame`, `frames` | This frame's number (fractional while a smear samples between frames) and how many there are. |
| `length(bone)` | A bone's length. |
| `random()`, `range(min, max)` | Numbers from the draft's seed, starting over on every frame. |
| `ease.in`, `ease.out`, `ease.inOut`, `lerp`, `clamp` | Curves and helpers for timing. |

A pose says what changes from the setup pose. Bones are solved parent
first, and on each bone an aim wins over a reach and a reach over the
bone's own turn, each by its `mix` (0 to 1, default 1):

| Pose field | What it does |
| --- | --- |
| `bones: { torso: -6, hips: { x: -3, y: -5, r: 2, sx: 1, sy: 1 } }` | Turns a bone from its setup pose (relative to its parent), and moves (in its parent's frame) and scales it. |
| `aim: { sword: 245, thigh: { angle: -40, mix: 0.5 } }` | A bone's world angle: "the blade at 245°", "the thigh at -40° and the shin hanging (-90°)", whatever its parents do. |
| `reach: { leg: { x: 4, y: 2, angle: 0 } }` | IK: the chain's end (an ankle, a wrist) on a world point. |
| `reach: { arm: { bone: "sword", along: -9, across: 3.5, turn: -90 } }` | IK to a point on another bone, moved by `dx` and `dy` in world axes: a hand on a grip, or a fist in front of the shoulder (`{ bone: "torso", along: 35, dx: 24, dy: -4, angle: 45 }`). The end bone keeps its setup world angle unless the goal says `angle` (world) or `turn` (from the goal's bone); the goal's bone must be declared before the chain's upper bone. |
| `slots: { smear: "default", hand: "fist" }` | A part's shape by `alt` name, `"default"`, or `null` to hide it. |
| `props: { sword: null }` | A prop shown (`"default"`), swapped to a look its parts have in `alt` (parts without it hide), or hidden, as one. A hidden prop's bones are exempt from every check, and from the trail. |
| `z: { handFar: 25 }` | A part's draw order, replacing its `z`. |

`rig.keys` takes keys, each a pose on a frame (`at`), with how it moves to
the next (`curve`: `smooth`, the default, flows through the keys on either
side; `linear`, `in`, `out`, or `stepped`) and `rest: true` where the
motion comes to rest (an extreme or a hold: smooth segments ease into and
out of it). Every value a key sets is its own timeline, a channel
(`bones.torso`, `aim.sword`, `reach.leg.x`, `slots.smear`), made of the
keys that set it, so a key may move a few bones only. One rule says where
each starts: on frame 0, every channel is the clip's `stance` (or the
rig's setup pose, for a clip with none), so the pose is the stance until
its keys change it, and the first key need not repeat it. A turn or move
the stance does not set starts from the setup pose's (0, and scale 1); an
aim or reach it does not have mixes in, from 0 on frame 0 to 1 on its first
key (key its `mix` to say otherwise); slots, props, and draw order are the
stance's (or the rig's own) until a key sets them. After its last key a
channel holds that key's value, so a one-shot ends on its stance with a
last key like `{ at: 25, ...rig.stances.ready }`. Slots, props, draw order,
and a goal's bone step: they hold until the next key that sets them. Key
lists that would key the wrong motion are errors, each naming the clip,
the frame, and the channel: two keys on one frame setting one channel, a
key past the clip's frames, and turns under an aim or reach (the keys' or
the stance's) at mix 1 on every frame, which would never show.

A bank is one file per character (`hero.rig.json`) naming the rig module
and each clip's drafts (paths from the bank's folder), with each draft's
`seed`, the person's `tune`, and `accept` (warnings judged deliberate,
each with why: `rig check` lists them apart and does not count them;
errors cannot be accepted), and the draft the game gets in `use` (the
first when unset):

```json
{
  "version": 1,
  "rig": "hero.js",
  "clips": {
    "idle": { "about": "Ready stance, breathing.", "drafts": { "a": { "file": "clips/idle.js", "accept": { "locked": "a held guard: the far arm only breathes" } } } },
    "attack": {
      "about": "Overhead sword chop from the ready stance and back.",
      "drafts": { "a": { "file": "clips/attack.js" }, "b": { "file": "clips/attack.b.js", "tune": { "overshoot": 18 } } },
      "use": "a"
    }
  }
}
```

Its review lives next to it (`hero.rig.json` → `hero.rig.review.json`):
each clip's status (`new`, `approved`, `changes`), the person's note, and
their comments, each pinned to a draft, a frame (from 0), and a pixel of
the frame (with the part there, the bone near it, and the phase), or to a
span of frames (timing: "frames 6-9 feel slow"), and resolved by the agent
with a reply (`rig resolve`). `examples/rig/hero.rig.json` in the
repository is a swordsman with an idle (two drafts: armed, and an
unarmed fighting stance), a walk, an overhead chop (two drafts), a block,
a punch, and a kick.

### The checks

`rig check` poses each draft twice. **Errors** (exit 3): a rig or clip
module that does not load or is not a rig or a clip (each field that is
wrong named), a pose that throws or names what the rig does not have
(`pose`), a key list that keys the wrong motion (`keys`, see above), and
a second run that poses other bones (`random`: use `rig.random()`). A
draft with errors gets no warnings until they are fixed. **Warnings**,
each with its frames and the bones or parts:

| Code | What it finds |
| --- | --- |
| `off-canvas` | A part (with its outline) past the frame's edge. |
| `below-ground` | A part other than a foot reaching more than 1 px under the ground line: a blade in the floor. |
| `floating`, `sinking` | A planted foot's sole more than 1 px above or under the ground. A foot chain is planted on every frame unless the clip's `contacts` say on which (`{ leg: [[0, 3], [9, 18]] }`). |
| `slide` | A planted foot drifting more than 0.5 px a frame against the clip's `travel` (the speed the game moves the character at, in px/s: planted feet move back at it). |
| `unreachable` | A chain's goal more than 0.5 px from its end at full mix: the limb is straight and short (an aim on the limb overrules its reach and is not counted). |
| `peek` | A far-side part seen (3 px or more) behind the middle line of the rig's `back` bone, at its height: an elbow poking out behind the back, or a far limb crossing over it. |
| `locked` | A chain's middle joint bending less than 5° over the whole clip: the limb never articulates. |
| `hyperextended` | A joint bending more than 3° past straight the wrong way. |
| `jerk` | A bone tip's speed changing by more than 8 px a frame from one frame to the next, and by more than half its speed, outside `fast` phases. A move starts and ends at rest (under 1 px a frame, or a dip in speed to under half the faster frame beside it: an extreme the motion slows into), and its first and last 2 frames are not flagged: easing out of a hold or into an extreme is not a pop. |
| `identical` | Consecutive frames of a loop with the same pose: the loop stops there. |
| `seam` | A loop whose last frame jumps back to its first (its step more than twice the median step, and 0.5 px). |
| `gap` | A frame with nothing drawn. |
| `draw-order` | A part changing draw order between frames (a pose's `z`), passing the parts listed: check it reads. |
| `stance` | The first frame, and for a one-shot the last, more than 1 px off the clip's `stance` on any shown bone, or showing parts the stance hides (or hiding parts it shows): a key on frame 0 that contradicts the stance, or a one-shot whose last keys do not return to it. |

Bones whose parts are all hidden on a frame (a put-away prop) are exempt
from every check on that frame, and from the trail. With each draft the
report gives its frames, length, stance, the box it fills, its params,
each joint's bend range (`look` gives the bend on every frame), the trail
bone's spacing (how far its tip moves into each frame), peak speed, and
arc (and with `fast` phases the swing's span, length, and how much of the
clip comes before it), and a verdict; each clip has a verdict too, so a new
clip is judged apart. `--positions handNear,sword` adds where each bone
named starts, its tip, and its angle on every frame, in world units.

### From a parts sheet

An image generator can draw a "character parts sheet": the head, torso,
and each limb of one character drawn apart on one background. Two
commands turn it into a rig whose parts are those pictures:

```sh
ritmo-tools rig parts art/hero-parts.png --names head,torso,upperArmNear,forearmNear,handNear,...
ritmo-tools rig init hero.rig.json --from art/parts/parts.json
ritmo-tools rig look hero.rig.json idle --art
```

`rig parts` clears the sheet's background as the pixel fixer clears an
animation sheet (its border colors flooded inward, painted grid lines
included) and cuts each drawn island, joined where islands nearly touch,
into `parts/<name>.png` with transparency. The pixels stay as drawn,
anti-aliased: there is no grid snapping and no palette. Parts come in
reading order (rows top to bottom, left to right), named from `--names`,
then `part-1`, `part-2`, .... Boxes that look like labels (three or more
small pieces in a row, short and wide like a word) and specks are left
out, each with a warning; so is a names list of the wrong length.
`parts/parts.json` lists each part's `name`, `file`, `size`, the `box` it
came from on the sheet, its long `axis` (from the end at its pivot to the
far end, its `length` and `width` across, in the part's pixels), and its
`pivot`.

The pivot is a guess for the agent to correct, by a simple rule: the point
on the part's long axis nearest the sheet's centre of mass, which
approximates the joint that attaches it toward the body; the part that
holds the centre of mass itself (the torso, drawn in the middle) pivots on
the lower end of its axis (the hips). A pivot on an end of the axis sits
half the part's width in from it (a quarter of its length at most), where
a rounded joint's centre is. It is right for limbs drawn with their joint
end toward the body, and wrong for a limb drawn pointing at the middle
(its far end is nearest): look at each part and fix its `pivot` in
`parts.json`, in the part's own pixels.

`rig init --from parts.json` writes a bank, a rig module (`rig/character.mjs`)
of a side-view humanoid facing right, and an idle draft that breathes on
its `stand` stance, so the first look shows the character assembled and
standing. It knows the parts `head`, `torso`, `upperArmNear`/`Far`,
`forearmNear`/`Far`, `handNear`/`Far`, `thighNear`/`Far`, `shinNear`/`Far`,
and `footNear`/`Far`: each picture's pivot sits on its bone's start, its
long axis is turned onto the bone (`angle`), and the bone runs from the
pivot to the far end of the axis. The far side draws through a darker,
cooler `tint`. A part the set does not have gets a plain capsule (an
ellipse for the head) so the rig still bakes; parts with other names
become props held at the near hand's end. It accepts no warnings: when
one fires, judge it, and accept it in the bank with why if it is
deliberate. Then correct what reads wrong in `rig look` in the module:
a pivot, an angle, a bone's length.

The limits: a side view, one character facing right, each part drawn whole
(overlaps included: a thigh drawn to the hip, not cut where the torso
covers it), and parts apart from each other on the sheet. A part drawn
twice (a near and a far arm alike) is cut twice; name both.

### The command line

`npx @typeonce/ritmo-tools rig <command>` (inside the Ritmo repository, `node packages/tools/bin/ritmo-tools.mjs rig <command>`).
Every command prints JSON and exits 0 (clean), 2 (usage error, missing
file, broken bank), or 3 (the rig or a draft has errors).

| Command | Does |
| --- | --- |
| `ritmo-tools rig init [bank] [--from parts.json]` | Writes a starting bank, a small figure's rig module (bones, parts, leg and arm chains, a stance), and an idle draft to build from; with `--from`, a side-view humanoid rig made of the pictures `rig parts` cut (see above). |
| `ritmo-tools rig parts <sheet.png> [-o dir] [--names head,torso,...]` | Cuts a character parts sheet into `parts/<name>.png` with transparency and `parts/parts.json` (each part's file, size, box, long axis, and guessed pivot), and warns about boxes that look like labels or are tiny (see above). |
| `ritmo-tools rig check <bank> [names...] [--positions bones]` | Poses every draft of every clip (or the named ones) twice and measures it, and lists errors and warnings (see above), with accepted warnings apart and a verdict per draft and per clip. |
| `ritmo-tools rig look <bank> <name> [--draft a] [--frames 5-10] [--scale 1] [--columns n] [--art] [--each] [--onion] [--compare] [--positions bones]` | Writes a contact sheet PNG per draft for the agent to look at: every frame (or `--frames`) numbered with its phase (`fast` ones in amber), on the rig's backdrop, in rows no wider than 2000 pixels; under each row the same frames with their bones, joints, and the trail bone's path (`--art` leaves them out). `--each` writes one picture per frame, `--onion` draws the frame before faintly under each, `--scale` draws them bigger, and `--compare` writes one picture instead: a row per draft, each column the same moment (`--columns` of them, 8 by default, first frame to last), to weigh the drafts against each other. The person's open comments are ringed (a pixel) or framed (a span) in magenta with their numbers. Prints every joint's bend on every frame. |
| `ritmo-tools rig bake <bank> [names...] [-o dir] [--scale 1]` | Writes each clip's draft in use for the game: a sprite sheet PNG (its frames in one row, anti-aliased on transparency), its JSON (the hash format Pixi, Phaser, and Aseprite read: each frame's rectangle, duration, and anchor from the rig's `anchor`, the animation and its fps, and `meta.loop`), a GIF on the rig's backdrop, and the bank's sidecar (`<bank>.clips.json`, every clip; see below). The report lists the sidecar and each clip's hit frames and sockets. Same inputs, same bytes. |
| `ritmo-tools rig review <bank> [--port 5194] [--host]` | Serves the review page and prints its address; runs until stopped. |
| `ritmo-tools rig notes <bank>` | What the person said: each clip's status, note, open comments, how many are resolved, draft in use, and tune, changes asked first; and the bank's `pivots` the person dragged, with what to do with them. A pixel comment has its `number`, `draft`, `frame`, `x` and `y` (frame pixels from the top left), `part`, `bone` (the part's own), `local` (the spot in that bone's frame, `[along, across]`), `phase`, `text`, and `where` in words ("draft a, frame 22 (up), pixel (146, 195), on blade (bone sword)"); a span comment its `number`, `draft`, `from`, `to`, `phases`, `text`, and `where` ("draft a, frames 6-9 (swing)"). |
| `ritmo-tools rig resolve <bank> <clip> <numbers...> [--reply "what changed"]` | Marks comments as resolved: `rig notes` and `rig look` stop showing them. |

### The review page

`ritmo-tools rig review` opens the bank on a local page: the clips on the
left with their status, every draft of the selected clip playing side by
side on one clock (one-shots rest a moment between plays), each card the
size of the rig's frame, and on the right, in this order, its Review
(status and note), its Comments, the Tune sliders of the draft in focus,
that draft's Check (each warning with **Show**, which pauses on its first
frame with its bones traced or its parts boxed; the accepted warnings with
their reasons; each joint's bend range), and Toggles (the bones overlay,
onion skin, the ground line). The playback bar plays and pauses, steps
frame by frame (the same frame on every draft), slows to ½ or ¼, zooms from
1× to 4× (the frames are baked at 2×), and shows the frame strip of the
draft in focus: a cell per frame, the current one lit, `fast` frames
tinted, a dot under each frame a key is on, and span comments as numbered
bands; clicking a cell goes there. Clicking a draft focuses it; **Use**
picks the draft the game gets.

Clicking a spot of the draft in focus pauses on that frame and pins a
comment to it, with the part drawn there, that part's own bone, the spot
in that bone's frame (so its ring follows the part when the agent changes
the pose), and the phase. For timing, press S (or **Span**) on a frame,
step to another, and press S again: the comment covers the frames between,
listed as "frames 6-9 (swing)". Resolved comments show greyed with the
agent's reply, and **Reopen** puts one back. Space plays, ← and → step, ↑
and ↓ change clip, 1 to 9 focus a draft, S marks a span, and Escape clears
rings and cancels a span.

With the bones on, each image part's pivot shows as a blue cross on the
draft in focus: dragging one to where the part's joint is saves the
picture pixel under it to the bank's `pivots` (`{"head": [19, 56.3]}`, in
the picture's own pixels), which the loader lays over the rig module's
pivots, as `tune` lays over params, and the draft rebakes. It is the one
way a person moves a pivot, and it never edits code: `rig notes` lists
pending pivots, and the agent copies each into its part's `shape.pivot` in
the rig module and removes them from the bank.

Every change is written to the bank and its review as it happens, so
`rig notes` reads it with no other step. The page's server watches the
bank's folder and rebakes what changed: a clip's module, its drafts; the
rig module, a picture, or a module the clips share, every draft; the bank,
the drafts whose tune, accept, or seed changed, or every draft when
`pivots` did. Each rebake reads the modules anew, and the page swaps the
new frames in without a reload, about a second after the edit.

### The bake's sidecar

`rig bake` writes, next to each clip's sheet and atlas JSON, one sidecar for
the whole bank, named after it (`hero.rig.json` → `hero.rig.clips.json`): what
a game needs from the clips besides their pixels, so gameplay (a hit, a
footstep, a spark at the blade's tip) follows the same frames the player
sees. The file is always complete and valid, every clip in the bank: a
full `bake` rewrites it, and `bake <names>` rewrites only the named clips'
entries and keeps the others as the last bake into that folder wrote them
(a sidecar baked at another scale, or from another rig module, is
rewritten whole). No code in Ritmo reads it: the game decodes it with its own Standard
Schema, at the boundary, and trusts the type from there. It is versioned
(`version`, now 1); a change that breaks a reader bumps it.

Coordinates are pixels of the baked frame (times `scale`) with **y down**
and the origin on the **anchor** (the ground under the character), so the
game adds its entity's position. Angles are **degrees from +x, clockwise on
screen**, as Pixi and Phaser turn sprites. The example bank's attack, with
one of its 26 frames and one of its phases shown:

```json
{
  "version": 1,
  "rig": "hero.js",
  "scale": 1,
  "size": [264, 212],
  "anchor": [118, 194],
  "clips": {
    "attack": {
      "draft": "a",
      "image": "attack.png",
      "atlas": "attack.json",
      "fps": 24,
      "loop": false,
      "duration": 1083,
      "travel": 0,
      "stance": {"start": "ready", "end": "ready"},
      "phases": [{"name": "swing", "from": 12, "to": 14, "fast": true}],
      "frames": [
        {"name": "attack 14", "contacts": ["footNear", "footFar"], "sockets": {"tip": {"x": 131.89, "y": -63.94, "angle": 6}}, "hit": {"from": [74.21, -70], "to": [131.89, -63.94], "radius": 3}, "bounds": {"x": -20, "y": -183, "w": 154, "h": 185}}
      ]
    }
  }
}
```

| Field | What it is |
| --- | --- |
| `version` | The sidecar's format version: 1. |
| `rig` | The rig module the clips were baked from. |
| `scale` | Pixels per world unit in the sheets (`bake --scale`), and so in every coordinate here. |
| `size` | A frame's width and height, in pixels. |
| `anchor` | The anchor's pixel in a frame, from its top left: every coordinate below is from it. |
| `clips.<name>.draft` | The draft baked: the clip's `use`. |
| `image`, `atlas` | The clip's sprite sheet and its atlas JSON (the hash format), next to the sidecar. |
| `fps`, `loop`, `duration` | Frames per second; whether it plays again from the start; one play, in milliseconds. |
| `travel` | How fast the game moves the character while the clip plays, in pixels per second (a walk's speed). |
| `stance` | `start`: the stance the clip starts on; `end`: the one it ends on (a one-shot's; a loop has none). `null` when the clip names none. |
| `phases` | The clip's named spans: `name`, `from` and `to` (frames from 0, both included), and `fast` (a snap: a swing, a strike). |
| `frames` | Every frame in order (`frames.length` is the frame count), each with: |
| `frames[i].name` | The frame's name in the atlas JSON (`"attack 14"`). |
| `frames[i].contacts` | The foot bones planted on the ground: the clip's `contacts` (every frame for a foot chain it does not list). A footstep plays where one is added. |
| `frames[i].sockets` | Each socket whose bone shows on this frame: `x`, `y`, and `angle` (its bone's direction). Sockets are named points on bones, in the rig's `sockets` and a clip's own: `{ grip: { bone: "sword" }, tip: { bone: "sword", along: 64 } }` (`along` the bone and `across` it). |
| `frames[i].hit` | The hit on the frames the clip hits on, else `null`: a segment, `from` and `to`, and `radius`, how far each side of it the hit reaches in pixels (a capsule: a blade's half-width, a fist's; 0 for a line). A clip's `hit: { bone, from, to, radius, frames }` is the segment of `bone` from `from` to `to` along it, `radius` wide each side (world units, 0 by default), on the `frames` spans; by default the trail bone's whole length on the clip's `fast` frames, and `hit: false` for a clip that hits nothing (a block). |
| `frames[i].bounds` | The box every drawn part fills, outline included, in whole pixels (`x`, `y`, `w`, `h`), or `null` on a frame with nothing drawn: for culling, and a simple hurtbox. |

A game keeps which clip plays and the step it started on, works the frame
out from its clock on every step (whole steps since the start × `fps` ÷
the step rate), and on each frame with a `hit` sweeps the capsule, placed
on its entity, from where the frame before left it to where this one puts
it, against its targets (with `Collide2` from
[`@typeonce/ritmo-math`](https://github.com/typeonce-dev/ritmo/blob/main/packages/math/README.md)).

### Code

- `src/rig/core/`: rig modules and poses decoded and checked (`rig.ts`),
  poses solved (turns, IK, aims) and parts placed (`pose.ts`), keyframes
  (`keys.ts`), clip modules and the runner that poses every frame
  (`clip.ts`), the anti-aliased rasterizer (`raster.ts`), banks and reviews
  (`bank.ts`), the checks (`check.ts`), the bake's sidecar (`sidecar.ts`), cutting a parts sheet (`parts.ts`, through the pixel fixer's sheet clearing) and a first humanoid rig from its parts (`scaffold.ts`), and contact sheets, sprite sheets,
  and GIFs (`export.ts`, through the pixel fixer's sheet and GIF writers).
- `src/rig/cli/`: the commands, loading the rig's and the clips' modules as
  files so their imports of each other resolve, and anew on a rebake
  (`io.ts`), and the page's server and its watcher (`serve.ts`).
- `src/rig/ui/`: the review page (`lab.ts`), reading, writing, and baking
  through a store (`store.ts`): the CLI's server (`main.ts`), or the tab for
  the website's demo (`demo.ts`, `example.ts`), which bakes the example bank
  in the browser with the same runner and rasterizer (`core/view.ts`). The
  published package carries it built (`dist/rig/page`, made by `prepack`);
  inside the repository Vite serves it from source.

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
