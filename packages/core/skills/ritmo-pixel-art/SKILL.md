---
name: ritmo-pixel-art
description: "Apply whenever a game's pixel art is made, changed, laid out, or checked: the game's grid and scale, the camera, scaling, parallax, or text rendering of a pixel-art game, a sprite drawn with code, a picture from an image generator, a reference image to turn into game art, tiles and sprites judged together in a screenshot, or assets checked before they ship (effects: the `ritmo-fx` skill). Holds the principles that make a game's pixel art read as one game, and says which `ritmo-tools pixel` command to run for each case and how to read its report."
---

# Pixel art for a game

Pixel art is a decision about the whole game, not one sprite at a time: one grid, one palette, one order in which the screen is read, one style. [`ritmo-tools pixel`](#the-tool) checks the grid, the palette, the color count, and lone pixels; whether a scene reads is judged by eye, in the game ([Judging](#judging)). Below, "art pixel" is one pixel of the art, "screen pixel" one of the display, and "display size" the art at the game's scale on the player's screen, not zoomed.

## Principles

### One grid

- **Pick the game's size in art pixels first, from the smallest detail that must read.** The screen in art pixels (say 320×180) and the tile and character sizes are chosen together, around the smallest thing that must be legible, usually a character's eyes. Smaller when in doubt: fewer pixels make every pixel count. Every asset after this is drawn for that grid, and changing it later means redrawing everything.
- **One pixel size across the game.** Every asset is drawn at the game's art-pixel size: no asset at another size, whole multiples included (a boss is drawn big, not scaled up), nothing scaled by a fraction, nothing smoothed. A second pixel size (a hi-res backdrop, a 2× portrait) is a style the person chooses once for the whole game, never a side effect of one asset.
- **Fit the screen by a whole number.** On each screen, scale the art by the largest whole number of screen pixels that fits, counting the screen's real pixels, not its CSS pixels; fill what is left with more world or a border, never with a fractional stretch. Either the whole frame is drawn at the game's size and scaled up once (the usual choice: rotated and zoomed sprites keep the game's pixel size), or every sprite is drawn at final size and snapped (crisper edges, when nothing rotates or zooms). A zoom changes the whole number, never by a fraction.
- **Keep fractions in the simulation; round only when drawing.** Positions stay fractional in the game state and are rounded to whole art pixels at the draw: every offset, the camera included, or sprites shimmer against the tiles. Each layer's offset is rounded on its own. Free rotation, a smooth parallax, or a sub-pixel camera is an exception ([Judging](#judging)); pre-drawn angles keep the craft.
- **Text is on the grid or on one separate layer.** A pixel font renders at a whole multiple of its design size with no sub-pixel positioning, or it blurs and its pixels come out uneven. Otherwise all text and UI go on one screen-resolution layer; never a mix, and never a pixel font scaled by a fraction. Text read at length is judged for legibility on the smallest screen the game targets.

### Readability

- **What the player must notice is read first.** Rank what the player needs to play, most urgent first: what can hurt or block them, what they can act on, what they control, then props, and decoration last. Brightness (value) contrast follows that order, with the strongest saturation reserved for the top of it; the backdrop recedes in both. What supports or blocks the player reads clearly against what is only backdrop. No large flat shape or busy texture competes with the top of the order.
- **Gameplay signals speak one language, in levels.** One meaning, one look, everywhere in the game: a warning comes before its consequence, and a routine signal is quieter than an urgent one ("could reach you" is dimmer and thinner than "is coming at you now"). If every signal is loud, none is.
- **Every kind of character or piece is its silhouette.** Each kind the player must tell apart is identifiable from its shape alone, with no interior shading; details never obscure the basic form. What the player controls is never confused with anything else: its shape and its accent color belong to it alone.

### One style

- **The characters set the rules; everything else follows them.** The characters, or the pieces in a game without them, are seen most, so their outline weight, shades per material, cluster size, and color count are the game's numbers: tiles, props, text, effects, and every generated or fixed asset keep to them, so a crack is a cluster like a fold in a cloak, not a hairline. A second style, if the game has one, lives in its own area and never leaks.
- **One palette, few colors, ramps that shift hue.** The game's palette holds a few ramps that shift hue as they brighten; each asset pulls its colors from it, and a material is one ramp in different values (a wall, its floor, and its ledges from one stone, not three). Start from an existing palette (`pixel palettes`, or Lospec's list) rather than inventing one.
- **Tiles hide the grid, unless the grid is the game.** A base texture that loops on all four sides and stays quiet; a few variants, chosen by hand or by a fixed function of the tile's position; rare details clustered where the world would wear (edges, corners, places that get used); decoration as its own layer. Rare is not none: a scene with every detail removed is a void, a detail on every tile is noise, and a variant is drawn, not recolored. Where the grid is gameplay (tactics, puzzles), it reads evenly and quietly instead.
- **Lines and shades follow the pixel craft.** Edges step in even runs, one-pixel lines stay one pixel, and shading follows the form from one light chosen before drawing, never the outline. The `ritmo-fx` skill's Craft lists these rules; `pixel lint` does not check them on sprites and tiles.
- **One light.** Every asset is shaded from the same light direction. When the engine lights the scene, assets carry their own few even shades and no strong baked lighting; the engine's light changes with the room, and gameplay signals stay at full brightness under it.

### Motion

- **Key poses first, few frames.** The motion reads from its key frames alone; in-betweens add smoothness, not energy, and too many make it sluggish. One frame of wind-up makes an action readable; the area stays the same frame to frame (a squash widens as it flattens). Timing and effects follow the `ritmo-fx` skill's Craft.

### Judging

- **Judge in the game, at display size, on the target screen.** A sprite is one piece of a crowded screen: look at captures of real scenes at display size, on the smallest screen the game targets, under the game's lighting if it has any, still and in motion, before anything goes in. Squint: the shapes that matter must still be there. A zoomed-in canvas shows the pixels, not the read. When the target screen is out of reach, say so; the person who plays judges there.
- **A reference is a set of named qualities, not a picture to copy.** Say what the reference gives (scale, proportion, palette, mood, detail level) and what the game keeps regardless; say what is not wanted too. Change what was asked for and nothing else, and show two or three options at display size and zoomed 4× beside the reference and in a game capture before integrating one.
- **An exception is a decision, written down.** A second pixel size, a rotating sprite, a smooth parallax, a broken constraint: each is fine when the person chooses it for a reason and the game's design notes say why, and wrong when it happens to one asset. A clean lint, or two agents agreeing, never settles a look; the person who plays does.

## The tool

`ritmo-tools pixel` checks, fixes, and makes pixel art. It ships in `@typeonce/ritmo-tools`: run it as `npx @typeonce/ritmo-tools pixel <command>` (add the package as a dev dependency to pin it to the game's Ritmo version). Below, `pixel <command>` stands for that. `pixel <command> --help` lists every flag, and the package's README explains the pipeline. A person tunes the same fixes by hand on the web page, https://ritmo.typeonce.dev/tools/pixel/.

Every command prints a JSON report on stdout and exits with what to do next:

| Exit | Verdict | Do |
| --- | --- | --- |
| 0 | `clean` (or fixed with confidence) | Use the file. |
| 2 | usage error, missing file, broken sprite source | Read stderr, or `problems` on stdout (each with its line), and correct the call or the source. |
| 3 | `fixable`: rules broken | Run `pixel fix` (a picture) or edit the source (a sprite), then check again. |
| 4 | `needs-person`: the grid is unsure | Open `<name>.preview.png`; give the grid with `--cell` and `--offset` if you can read it, or hand the recipe to the person (it opens in the web page). Never ship a needs-person fix as done. |

### The project's rules

A `pixel.config.json` at the game's root (`pixel init -p <palette>` writes one) holds the palette, the allowed sizes, the color limit, and whether the background must be transparent. Every command reads it from the working directory up, so never repeat them on the command line; change the config instead when the rules change. `pixel palettes` lists the presets.

### Pick the case

- **Drawing a sprite with code.** Write a sprite source (below), then `pixel render sprite.txt --scale 8`: it writes `.png`, `@8x.png`, `.svg`, and `.preview.png`, and lints the art. Fix every error in the source, never in the PNG. The preview shows the pixels; whether the sprite reads is judged in a game capture ([Judging](#judging)).
- **A picture from an image generator.** `pixel check pic.png` first. `fixable` → `pixel fix pic.png` writes the true-size `.png`, `.svg`, a JSON map, a `.sprite.txt` (to edit by text), its `.recipe.json`, and a `.preview.png` (the source and its grid beside the fix). Add `--colors N` when there is no palette, `--remove-background` for a sprite, `--cleanup 1` against noise specks.
- **An animation sheet from an image generator** (frames side by side in boxes, often labelled). `pixel sheet sheet.png --colors 16` clears the background and labels, finds the frames, fixes them on one grid and palette, lines them up (by default on the ground: sideways drift removed, hops kept; `--anchor feet` pins the feet to one row), and writes the sheet `.png` and its `.json` (Pixi, Phaser, Aseprite), a `.gif` per animation, `.frames/`, the recipe, and a `.preview.png`. Each row of frames is one animation (`animation-1`, ... in reading order; `animation.animations` in the report lists each one's frame numbers): name them and keep the ones the game uses with `--animations "walk-down=1-4;throw-down=5-8;explode=29-38"` (every frame in one; a row that is not one animation is split or joined here) and `--only walk-down,explode`, then play them by name from the JSON's `animations`. Open the preview: each frame's box must hold the whole frame, and each animation's boxes share a color. Pass `--boxes "x,y,w,h;..."` when one is cut, `--skip 3` to leave a bad frame out, `--anchor center` for things that float, `--fps` and `--pingpong` for the timing, and `--columns N` for rows. Look at each `.gif` before using it.
- **A reference image (a drawing, a render, a photo) to turn into game art.** `pixel pixelate ref.png -w 32` cuts it into 32 pixels across on the project's palette (or `--colors N` proposed from the picture). Pixelating loses detail by design: compare widths by their previews, keep the smallest one that still reads, then touch up the `.sprite.txt` and `render` it.
- **Checking assets before they ship.** `pixel lint` each PNG at its true size (exit 0 for all of them), or `pixel check` for pictures that may be upscaled. `pixel compare a.png b.png` says which of two versions is better and why.

### Sprite sources

```
# Lines starting with # are comments.
palette
. transparent
K #1a1c2c
Y #ffcd75

pixels
.KK.
KYYK
.KK.
```

One character per key, every row as wide as the first; `pixel fix` writes keys that name the color (K black, W white, R red, O orange, Y yellow, G green, C cyan, B blue, P purple, M pink, D and L greys). A JSON map (`{width, height, palette, pixels}`, -1 transparent) is read too.

### Recipes

A recipe holds every setting of a fix, the grid and hand edits included. `pixel fix` writes one next to its outputs, the web page saves one (**Recipe**), and `--recipe file` runs it: the same picture with the same recipe fixes the same way in both. When a person must finish a fix by hand, `pixel fix pic.png --project` writes `pic.project.png`: the picture with the recipe inside, which opens in the web page with every setting. A project PNG the person sends back runs as it is: `pixel fix pic.project.png` uses the recipe it holds (`"storedRecipe": true` in the report).

A project PNG is never a game asset: ship the fixed `.png`. To spot one, `grep -a ritmo-pixel-recipe file.png` (the recipe is an uncompressed `iTXt` chunk with that keyword); to make it a plain picture, `exiftool -all= file.png` or `oxipng --strip safe file.png`.
