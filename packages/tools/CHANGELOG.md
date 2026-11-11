# @typeonce/ritmo-tools

## 0.24.0

### Minor Changes

- 571c0ea: `ritmo-tools pixel`: find the grid of a small sprite on a large canvas, and never call an upscale pixel art at its own size. Measured with the benchmark of [xprite-pixelate](https://github.com/rhinoc/xprite-pixelate) (MIT) and [pixel-bench](https://github.com/Retro-Diffusion/pixel-bench) (MIT).
  
  - **The grid is read on the subject.** `pixel check`, `pixel fix`, and the page find the cell size on the picture's visible pixels, or, on an opaque picture whose border is one color (an image generator's off-white page), on the pixels away from that color, then place the grid on the whole picture. A sprite filling a fifth of its canvas came out with cells several times too large; on the AI benchmark, exact sizes rise from 65% to 76%, and from 24% to 99% for a small sprite on a clear canvas.
  - **An upscale is not pixel art at its own size.** A picture whose neighbouring pixels rarely change color and that has more than 32 colors is judged as a fix, so a grid that cannot be found reports `needs-person` ("Unsure of the grid") where it reported `clean` or `fixable` at the picture's full size. Flat pixel art of a few colors (a parallax layer) is still pixel art at its own size.

## 0.23.0

### Minor Changes

- 5472516: An fx approval covers everything `fx render` hands the game, a broken draft exits 3 in every `fx` command, and `kill` ends a stuck command.
  
  - **fx approvals.** Approving an effect (on the page, as before) now also keeps whether it loops, its canvas size, and its anchor, beside the draft, fps, and frame hashes. `fx notes` and `fx render` say when one of them changed (`changedSinceApproved: "its anchor moved from 12,12 to 0,0"`); before, an effect whose anchor moved still read as approved while the game drew it somewhere else. An approval stored before this keeps no anchor or loop: it is not reported as changed for that, but as `unrecorded: true`, with a `next` naming what it did not keep ("Approved, with no record of its anchor or whether it loops: ask the person to look again"), and is not counted among the approved. Ask the person to approve it again on the page.
  - **Exit 3 for a broken draft.** `fx render` and `fx look` exit 3, as `fx check` does, for a draft that does not load or whose `draw` throws, names a color or ramp the bank does not have, or runs past the time limit, with `{ error, effect, draft, errors, next }` on stdout. Before, `fx render` exited 2 (a usage error) and `fx look` exited 2 for a draft that does not load and 0 for one whose `draw` throws.
  - **Stopping.** SIGTERM and SIGINT end any command at once, even one stuck in synchronous work (a draft that loops as it loads, a large bake); before, the CLI listened for them on its event loop, so such a command outlived `kill` and `timeout` until SIGKILL. A review server still stops on either and exits 130.
- 9952b63: The review pages answer only on this machine, and no longer lose what the agent wrote; every tool's `notes` reports the same things; and bad input is refused with what to change.
  
  - **Review servers.** A request whose `Host` is not `localhost`, `127.0.0.1`, or `[::1]` on the page's port (or, with `--host`, an address the server printed) gets 403, so a web page open elsewhere cannot reach a game's files by DNS rebinding. `fx review` reads a draft or a stand-in only inside the bank's folder, links followed, and `music review` writes only the song's hum (`<name>.song.reference.wav`, a WAV).
  - **No lost writes.** Every bank, review, and song save from a page carries the version of the file the page read; when the agent wrote the file meanwhile (takes from `sound vary`, a rewritten song, a resolved comment), the server answers 409 and writes nothing, and the page lays the person's change over the agent's and saves again. A save that fails stays owed on the sound and fx pages, as on the music page. Pages, servers, and commands write each file whole (to a file beside it, then renamed).
  - **Notes.** `sound notes`, `fx notes`, and `music notes` list `gone` as `pixel notes` does: what was said about a sound or effect the bank no longer has, a song's review with no song beside it, or a plain audio file's review whose file is gone, with where to move or remove it; every summary counts them. An approval with no record of what was seen (from an older version, or edited by hand) is `unrecorded: true`, its `next` says to ask the person to look again, and it is no longer counted among the approved in any tool.
  - **Limits.** Pictures are read up to 4096 × 4096 pixels in all and 16384 on a side; a header claiming more is refused before decoding instead of running for minutes. `pixel bake` draws at most 1024 frames of at most 1024 art pixels on a side, and a cylinder has at most 256 `sides`. In the CLI, an fx draft's `draw` that runs past 5 seconds on a frame is stopped and is an error: "draw did not return within 5 s on frame F" (`fx check` and `fx look` exit 3). An unexpected throw prints one line, `<tool> <command> failed: <message>`, with no stack, and exits 1.
  
  **Breaking:** these are refused now where they were taken before. Each says what to change:
  
  - A key `pixel.config.json`, a pixel recipe, a sound bank or recipe, an fx bank, or a song does not know: `unknown key maxColours: did you mean maxColors?`, exit 2. Rename or remove the key. `pixel.config.json` also lists every problem now, not the first.
  - An fx bank's draft `file` or `standIn.file` that is absolute or has a `..` in it. Keep the bank in a folder that holds its drafts and art:
  
    ```diff
    -fx/game.fx.json   { "standIn": { "file": "../public/art/hero.png", ... } }
    +game.fx.json      { "standIn": { "file": "public/art/hero.png", ... } }
    ```
  
  - A number flag outside its range, which some commands clamped or took: `--count` 1 to 12 (it was clamped), `--sequence` 0 to 10, `--cleanup` 0 to 64, `--shrink-to`, `--width`, and `--height` 1 to 16384, `--scale` 1 to 32, `--colors` 1 to 256, `--columns` 1 to 1024 (`fx look`: 1 to 64), `--spacing` 0 to 64, `--strength` 1 to 400, `--fps` 0.1 to 120, `--tempo` 30 to 300, and `--port` 1 to 65535. The usage error names the flag, the value, and the range (exit 2); pass a value inside it. `pixel sheet --boxes` takes only boxes inside the picture, and `--skip` only frames the sheet has.

## 0.22.0

### Minor Changes

- 256993e: `ritmo-tools pixel bake` draws sprites from a model of 3D shapes (`<name>.bake.json`) through one camera and one light, set once in `pixel.config.json` under `bake`, so a set of buildings, vehicles, or props stays one set. A model can be boxes, cylinders, spheres, flat faces, and free meshes, in groups and repeats, with hand-placed pixels on top, and can turn to any number of headings and animate. It writes a clean PNG on the palette, a sprite source or a sheet, a preview, and on request a normal map from the real surfaces and a ground shadow. `pixel review` names the model as the art's source. The `ritmo-pixel-art` skill says when to use it.
- c794bca: `ritmo-tools pixel normals` makes a normal map for art a game lights: `.normal.png`, `.normals.json` (settings and corrections), and `.lit.png`. A sheet keeps each surface's direction through its animation, and the report measures what still flickers. `pixel review` shows art under a light you can drag, the whole set under one light, and comments can carry a direction; approvals cover the map. `pixel lint` checks a map against its art, and says when the art changed since. The method follows Pixel Art Lighter by Red Hat Sprite (MIT).
- 95f5218: `ritmo-tools pixel review` reviews each part of a file apart. On the list, a file opens into its sprite or its animations, and the normal map of each, each with its own status, note, comments, and lint, and the file's status follows from them. Each part's controls sit at the bottom left and the zoom stays at the bottom right. Holding **Without map** (or M) shows the same light with no map, and the light has a **Half-Lambert** switch. A new map only flags the animations whose frames it changed. In the whole set, a click on a tile picks it and the arrow in its corner opens it. **Approve them** now approves only what shows, so a sheet's animations and their maps need opening. `pixel notes` lists `parts`, each with its own status and note, marks comments on the map with `about: "map"`, and lists `goneParts`, and `status` is now the file's status across its parts. A `pixel.review.json` from before parts still reads: what it said about a sheet stands for each animation, until one is reviewed on its own.

## 0.21.0

### Minor Changes

- 15e5aa9: `ritmo-tools fx`: judge effects at native size, and see when an approved effect has changed. Ideas from [PVFX Foundry](https://nerijs.itch.io/pvfx-foundry).
  
  - **1× zoom** on the review page, to judge whether an effect reads at its native size.
  - **Approval keeps what the person saw.** Approving an effect saves the draft in use, its fps, and a hash of each frame's final colors. When any of them later differ, `fx notes` and `fx render` list `changedSinceApproved` (`"frames 3-5 look different"`), and the page shows it with **Approve it as it is now**. The status stays approved: only the person changes it. A palette edit counts as a change. A review saved before this has no hashes, and reports nothing until the effect is approved again.
  - The `ritmo-fx` skill adds a craft rule (each material dies its own way), the native-size question for the person, what to do with `changedSinceApproved`, and PVFX Foundry's Strict tier as a reference to look at.
  - The example `explosion` draft `a` now sits on the floor, with thrown debris, embers, dust, and smoke that comes apart in clumps.
  
  Breaking: `fx render` writes sprite sheets in rows of up to 8 frames, not one row, so a long effect stays within a device's texture limit. A game that reads each frame's rectangle from the JSON (`frames["hit 0"].frame`, as Pixi and Phaser do) needs no change. Replace code that computes a frame's place as `x = frame * width` with `x = (frame % 8) * width` and `y = Math.floor(frame / 8) * height`.
- 6b7df96: `ritmo-tools music` and `sound`: review all of a game's music on one page, and see when something approved has changed.
  
  - **`music review` takes songs, audio files, and folders**, and shows them all on a list with each one's status, filtered by what is left to do. A folder is searched for `*.song.json` and audio files, leaving out what the tool wrote beside a song (its render, its stems, its hum). What the person has not saved yet is written before another piece opens.
  - **Plain audio files can be reviewed** (`.wav`, `.flac`, `.mp3`, `.ogg`, `.m4a`): play, loop, hear the loop point, read the length, loudness, and peak, approve or ask for changes, and comment on a stretch of time. Their reviews live in one `music.review.json` beside the game's `package.json`, not beside the files, since those often sit in a folder that ships with the game.
  - **Approval keeps what the person heard**, in `music` and `sound` as it already did in `fx`. When an approved song, sound, or file later differs, `music notes`, `music render`, `sound notes`, and `sound render` list `changedSinceApproved`, and the page shows it with **Approve it as it is now**. The status stays approved: only the person changes it. An edit to words alone (an `about`, a track's name) is no change. A review from before this keeps its approval, with nothing to compare against until it is approved again.
  - The music page checks a song in a worker, so a long song no longer holds the page for seconds when it opens, and going back to a song is instant.
  
  Breaking: `music notes` now prints `{ summary, music: [...] }` for any paths, one entry per piece, with `file`, `kind`, and `review` beside what it printed before. Replace `.status`, `.note`, `.comments`, `.edits`, and `.next` with `.music[0].status` and so on. `music review` prints `music` (the list of what it found) in place of `song` and `review`.
- d1d864d: **Breaking: the packages require Node 22 or newer (Node 20 reached end of life on 2026-04-30).** `engines.node` is `>=22` for `@typeonce/ritmo`, `-browser`, `-render`, `-pixi`, `-math`, and `-netcode`; `>=22.12` for `@typeonce/oxlint-plugin-ritmo` (oxlint's own floor); `>=22.15` for `@typeonce/ritmo-devtools` (unchanged); and `>=22.19` for `@typeonce/ritmo-tools` (what `@effect/platform-node` needs). On Node 20, upgrade Node: `nvm install 22` (or 24), or `"node": ">=22"` in your CI's setup step.
- f30c9c6: `ritmo-tools pixel`: hold a frame, see an animation as a still, and check a tile's edges. Ideas from [Pixelorama](https://github.com/Orama-Interactive/Pixelorama).
  
  - **Holds.** `pixel sheet --animations "attack=5,6x3,7,8"` shows frame 6 for 3 beats, a beat being one frame at `--fps`. The JSON's `duration`, the GIF, the recipe (`sheet.frames[i].beats`), and the page's player all follow it, the page sets it on the chosen frame, and the report lists each frame's time in `durations`.
  - **Onion pictures.** `pixel sheet` writes `<name>.<animation>.onion.png`: a panel per step of playback, each frame over the one before in red and the one after in blue, so an agent that cannot watch an animation can see a jump, a drift, or a change of size.
  - **Tile seams.** `pixel lint tile.png --tile both` (or `x`, `y`) warns of a `seam` when a tile's edges do not meet, and `pixel preview tile.png --tile both` writes it repeated.
  - The `ritmo-pixel-art` skill says when to use each, and that a game plays each frame for its `duration`.
  
  Breaking: the sprite sheet JSON of `pixel sheet` and `fx render` no longer has `meta.fps`, since one rate would lose a frame's hold. Replace `meta.fps[name]` with each frame's time, `frames["<name> 0"].duration`, in milliseconds. With Pixi, give `AnimatedSprite` `{ texture, time }` objects built from those durations.
- 215ba15: `ritmo-tools pixel`: one-pixel outlines, bent grids, and a shrink that keeps strokes whole, after [ToPixel](https://github.com/daisuqe/ToPixel).
  
  - **Outlines** (`outlines` in a recipe, `--outlines auto|on|off`, **Outlines** on the page; `"auto"` by default): when the picture's dark strokes are about one cell wide, a stroke a grid line split between two pixels goes back to one, never breaking the outline or a corner, and followed lines keep off dark strokes. The report's `grid.outlines` says whether it ran.
  - **Follow lines** is now a choice: `"off"`, `"straight"` (every line placed at once, each on a strong edge with every gap near the cell size, instead of one after another), or `"bend"` (lines placed in each row and column of cells on their own, for a grid the generator warped). The page draws bent lines bent.
  - **Keep outlines** when shrinking (`--shrink-to`, **Size**) carries outlines over as strokes: thinned back to one pixel without breaking, one-pixel steps turned into diagonals. A one-pixel ring shrunk from 16 to 11 pixels stays whole, where it used to lose its sides.
  
  Breaking: a recipe's `follow` is `"off"`, `"straight"`, or `"bend"`, no longer `true` or `false`, and `--follow` takes one of them. Replace `"follow": true` with `"follow": "straight"` (`--follow straight`), and `"follow": false` with `"follow": "off"` (or leave it out).
- d989c0b: `ritmo-tools pixel`: review all of a game's pixel art with a person on one page, and read back what they said.
  
  - **`pixel review <paths...>`** serves a local page (port 5193) with every PNG and text sprite under the folders named, by folder, each with its status. A person looks at each asset at whole-number zooms, opening as large as fits with 1× a key away, over a dark, light, checkerboard, or custom backdrop, plays sheets by animation with their durations, sees a tile repeated, lines the whole set up at one scale on a grid by size (picking several to compare or approve at once), approves or asks for changes, and drags over the art to pin a comment to an area of pixels on one frame. Each asset's lint against its nearest `pixel.config.json` shows beside it. What the tools write beside the art (previews, project PNGs, onion pictures, scaled copies, frame folders) is left out, and a fix shows as one row with what it was made from.
  - **`pixel notes <paths...>`** prints a `summary` of what is left, then each asset's status, note, open comments (numbered, with their area and frame), how many are resolved, its lint, and `next`, changes asked first. **`pixel resolve <asset> <numbers...> --reply "..."`** marks comments done; the open page shows them with the reply.
  - **Approval keeps the pixels the person saw**: a hash of each frame as decoded, and its duration. A re-export that looks the same is no change, and neither is a color hidden under a transparent pixel. When an approved asset later looks different or plays at other timings, `pixel notes` and the page say which frames under `changedSinceApproved`, and the page offers **Approve it as it is now**.
  - The review lives in one `pixel.review.json` beside the game's `package.json`, keyed by path, out of the folder that ships.
  - `review`, `notes`, and `resolve` exit 0 or 2 only.
  - `pixel lint` no longer runs out of memory on a picture of thousands of colors (a smooth app icon took gigabytes comparing every pair): past 512 colors it says the picture is not pixel art yet instead. On the review page and in `pixel notes`, a sheet frame with nothing drawn in it is an `empty-frame` error.
  
  The `ritmo-pixel-art` skill says when to open the review and how to act on it, and that approving on the page does not replace looking at the art in the game at display size.

### Patch Changes

- ea008a4: `ritmo-tools` depends on Effect 4.1.1 (`effect`, `@effect/platform-node`, and `@effect/platform-node-shared`, still pinned exactly and together).
- f715940: `pixel review` and `pixel notes` fixes, from trying them on real games:
  
  - The page keeps saving after the agent renames or replaces art it holds a review of (`pixel fix` does, putting `X.fixed.png` in place of `X.png`). Saves used to fail until a reload, which lost what was unsaved. The old review stays in `pixel.review.json` under its old name, and `pixel notes` lists it under `gone`.
  - A page that has not heard an asset came back can no longer write over that asset's review.
  - A comment being typed survives a click on a status or a reply from the agent, and is added when the person moves to another asset, animation, or view. Cancel or Esc drops it.
  - `pixel notes` no longer says "Leave it as it is" about an approved asset with open comments. An asset with a note or comments but no status comes ahead of untouched ones, and the summary counts it apart.
  - The server answers while it reads a large folder, and the page says how far it is. Past 500 assets, `pixel review` and `pixel notes` warn to name narrower folders. The page gets a picture's file as it is, rather than a copy written for it up front, so a large folder takes about a third less time and far less memory.
  - Holding an arrow key down in Safari no longer stops the page moving through assets.

## 0.20.0

### Minor Changes

- b5f78e7: `ritmo-tools fx`: pixel art effects as code. Each effect in a bank (`game.fx.json`) has a few drafts, each a small JavaScript module that draws one frame at a time with the palette's color names (`fx.px`, `fx.line`, `fx.disc`, `fx.ring`, `fx.ramp`, `fx.random()` from the draft's seed), and params the person can tune. Circles are drawn as pixel artists draw them: no doubles, even steps, and `fx.ring` takes a width with no pinholes.

  `fx check` runs every draft and lists what an agent cannot see by reading code, with the frames and pixels where: errors (a module that does not load or throws, nothing drawn, randomness not from the seed, colors outside the project's `pixel.config.json` palette or over its `maxColors`) and warnings (cut off at the canvas edge, a one-shot that starts late or does not end empty, a loop that jumps, blinking, lone-pixel noise, jaggies, doubles, pinholes, flicker, and an effect too faint on one of the game's backgrounds, listed in the bank's `backdrops`). A draft's `accept` records a warning judged deliberate, with why. `fx look` writes a contact sheet of every frame for the agent to look at, with the person's comments or a rule's spots ringed. `fx review` opens a local page where a person watches the drafts side by side, slowed down or frame by frame, picks one, tunes it, and clicks a pixel to pin a comment to it; `fx notes` reads it all back. `fx resolve` marks comments done with a reply the person sees. `fx render` writes the chosen draft as a sprite sheet PNG with its JSON (Pixi, Phaser, Aseprite; each frame's anchor from the draft's `anchor`, and `meta.loop`) and a GIF. The page also runs on the website with an example bank: https://ritmo.typeonce.dev/tools/fx/.

  `@typeonce/ritmo` ships a new skill, `skills/ritmo-fx`, with the pixel art craft the checks measure. Link it next to the others:

  ```sh
  ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-fx .agents/skills/ritmo-fx
  ```

- 7b0dcd2: `ritmo-tools fx`: ramps, recolor, palette editing, a stand-in sprite, draft comparison, and reach across seeds.

  - A bank's `ramps` name fades through its palette (`"fire": ["white", "yellow", "orange", "red"]`), and drafts draw with them by name: `fx.ramp("fire", v)`. A draft's `recolor` draws one ramp with another's colors (`{"fire": "frost"}`), so a blue fire is the same file with one line in the bank; the review page's Tune section picks it too. A ramp the bank does not have is an error.
  - A bank's `standIn` is a PNG of one of the game's sprites with the pixel at its feet (`{"file": "art/hero.png", "anchor": [10, 45]}`). The page and `fx look` draw it behind every effect, so its size reads against a body. It stands on the effect's anchor, moved by the effect's `standIn` offset (`[0, 24]` for a hit's target), or not at all with `false`. `fx look --alone` and the page's Background section leave it out.
  - `fx look --compare` writes one picture of every draft of an effect, a row each, the same moments in each column, to weigh the drafts against each other.
  - `fx check` also runs each draft with seeds 2, 3, and 7, and warns (`clipped-seed`) when the draft's own seed keeps it inside the canvas only by luck.
  - The review page's Palette section lets the person change the bank's colors (picked from the project's `pixel.config.json` palette when it has one) and its ramps (steps picked, reordered, added, removed; new ramps), for every effect at once. `fx notes` lists the palette and ramps as they are now.
  - New shapes: `fx.oval` and `fx.ovalRing` (ellipses with clean steps, for pools and shock rings flat on the floor), `fx.sparkle` (a star glint), and `fx.streak` (a moving spark's trail along a ramp).

  The `ritmo-fx` skill adds the bank's stand-in and ramps to its loop, `--compare` before showing drafts, open-source effects to read for choreography, phases with a white hero frame, and a table of what you see and the usual fix.

## 0.19.1

### Patch Changes

- 3e2e594: The sound lab's and the music lab's review pages also run on the website, with an example kept in the tab: https://ritmo.typeonce.dev/tools/sound/ and https://ritmo.typeonce.dev/tools/music/. `ritmo-tools sound review` and `ritmo-tools music review` work as before.

  `ritmo-tools` starts again on a fresh install: it failed with `does not provide an export named 'NodeWS'` once Effect 4.1.0 was published, because `@effect/platform-node` 4.0.6 pulled `@effect/platform-node-shared` 4.1.0. The tools now use Effect 4.1.0 throughout, with `@effect/platform-node-shared` pinned to the same version.

## 0.19.0

### Minor Changes

- 6e69a51: `ritmo-tools pixel`: project PNGs. A project PNG is the source picture with its recipe stored inside (one uncompressed `iTXt` chunk, keyword `ritmo-pixel-recipe`; the pixels are untouched), so one file reopens a whole session. The web page exports one (Export → **Project PNG**, for pictures and animation sheets) and restores every setting when it opens one. `pixel fix --project` writes `<name>.project.png`, and `check`, `fix`, `sheet`, and `preview` run the recipe a project PNG holds (a `--recipe` file wins over it; the report says `"storedRecipe": true`). A project PNG is not a game asset: `exiftool -all=` or `oxipng --strip safe` turns it back into the plain picture.

  Grid detection finds cells that a screenshot or resize stretched a few percent on one axis, instead of falling back to a fraction of the cell (a sprite came out 25×68 instead of 28×32).

  The `ritmo-pixel-art` skill says when to hand a person a project PNG, and how to spot and strip one.

- 612c30a: `ritmo-tools pixel`: several animations on one sheet. Each row of frames is one animation by default (`animation-1`, ... in reading order; where two blocks sit side by side, a row across both is split where they meet). The page's **Animations** panel chooses which are exported (**In**/**Out**), plays, renames, and sets each one's speed and loop, and **Split here** (between two frames of the chosen animation) and **Join with** regroup them. Each animation gets its own canvas. The sheet PNG holds every exported animation, each from a new row; its JSON names each one under `animations` and `frameTags`, frames are named `<animation> 0`, ..., and `meta.fps` is a map from animation to frames per second. `pixel sheet` writes a GIF per animation (`<name>.<animation>.gif`) and frames under `.frames/<animation>/`, lists the animations in its report (`animation.animations`), and takes `--animations "walk=1-4;explode=5-14"` and `--only walk,explode`.

  Breaking, for recipes and code reading the sheet: `sheet.fps` and `sheet.loop` moved onto each animation (`sheet.animations[i].fps`, `.loop`). A recipe without `animations` still reads, as one animation of every frame at its `fps` and `loop`. The report's `animation.fps` and `animation.loop` are now per animation in `animation.animations`, and `output` is the size of the sheet written.

  The `ritmo-pixel-art` skill says how to name and pick animations with `--animations` and `--only`.

- 832169a: `ritmo-tools music`: game music as JSON songs (a tempo, a key, bars, and tracks of notes, each track one of sixteen synthesized instruments: piano, electric piano, acoustic and distorted guitar, bass guitar and a reese bass, strings, flute, marimba, bells, a pad, a supersaw lead, two chiptune voices, and a clean and a punchy drum kit; `"compressor": true` squeezes a rock or electronic song louder and punchier). `music listen <song> <audio.wav>` hears a hum, a whistle, a tapped beat, or a recording and writes its tempo, key, and melody into the song as its reference, for the agent to build the song around; a voice that sits off pitch the whole way is heard in tune. `music check` measures the song and lists what usually sounds wrong (clipping, notes outside the key or an instrument's range, a buried track, a melody that wandered from the reference); `music render` writes a seamless looping WAV, a MIDI file, and with `--stems` each track alone. `music review <song>` opens a local page where a person plays the song, records a hum from the microphone, edits notes on a grid, swaps instruments, and comments on bars; `music notes` gives the agent the comments and a list of the person's edits.

  `@typeonce/ritmo` ships a new skill, `skills/ritmo-music`. Link it next to the others:

  ```sh
  ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-music .agents/skills/ritmo-music
  ```

- 818ad0b: `ritmo-tools sound`: game sounds as JSON recipes. Agents write sounds into one bank file, check them (`sound check`: length, loudness, clipping, a late start, a click at the end, much louder or quieter than their kind), make takes nudged one way (`sound vary --toward heavier`), and write WAV files (`sound render`). `sound review <bank>` opens a local page where a person listens, picks among takes, tunes with sliders, and approves or notes each sound; `sound notes` gives the agent the person's answers.

  `@typeonce/ritmo` ships a new skill, `skills/ritmo-sounds`. Link it next to the others:

  ```sh
  ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-sounds .agents/skills/ritmo-sounds
  ```

### Patch Changes

- 793a5f3: The pixel fixer's page opens pixel art that is already at its own size (a small sprite, even with an image generator's noisy colors) one pixel per cell, as `ritmo-tools pixel check` does, instead of applying an unsure grid its own shapes suggest (a 24×24 sprite came out about 8×8).

  Animation sheets: frames are found on sheets made of blocks side by side whose rows do not line up (walking on the left, throwing on the right), instead of boxing frames from two rows together, and a last frame of a few pixels (the end of an explosion) is kept instead of dropped. Such a sheet opens as an animation: most frames alike is enough, so a few faint frames (sparks, smoke) no longer make the page open it as a single picture.

## 0.18.0

### Minor Changes

- 8322cd7: New package `@typeonce/ritmo-tools`: the `ritmo-tools` command, asset tools for agents. `ritmo-tools pixel` is the pixel fixer: it checks, fixes, and makes pixel art, and fixes animation sheets from image generators (`ritmo-tools pixel sheet`) onto one grid and palette, lined up, as a sprite sheet with its JSON (Pixi, Phaser, Aseprite) and a GIF. Run it with `npx @typeonce/ritmo-tools pixel <command>`, or add it as a dev dependency.

  `@typeonce/ritmo` ships a new skill, `skills/ritmo-pixel-art`, telling agents which `ritmo-tools pixel` command to run for each case. Link it next to the others:

  ```sh
  ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-pixel-art .agents/skills/ritmo-pixel-art
  ```
