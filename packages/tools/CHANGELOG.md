# @typeonce/ritmo-tools

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
