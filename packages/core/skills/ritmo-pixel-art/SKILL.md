---
name: ritmo-pixel-art
description: "Apply whenever a game's pixel art is made, changed, laid out, or checked: the game's grid and scale, the camera, scaling, parallax, or text rendering of a pixel-art game, a sprite drawn with code, a picture from an image generator, a reference image to turn into game art, tiles and sprites judged together in a screenshot, or assets checked before they ship (effects: the `ritmo-fx` skill). Holds the principles that make a game's pixel art read as one game, and says which `ritmo-tools pixel` command to run for each case and how to read its report."
---

# Pixel art for a game

Pixel art is a decision about the whole game, not one sprite at a time: one grid, one palette, one order in which the screen is read, one style. [`ritmo-tools pixel`](#the-tool) checks the grid, the palette, the color count, lone pixels, the craft of edges and lines, and an animation's motion, draws a reference's parts at the game's sizes, and draws art as the player will see it; whether a scene reads is judged by eye, in the game ([Judging](#judging)). Below, "art pixel" is one pixel of the art, "screen pixel" one of the display, and "display size" the art at the game's scale on the player's screen, not zoomed.

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
- **Lines and shades follow the pixel craft.** Edges step in even runs, one-pixel lines stay one pixel, and shading follows the form from one light chosen before drawing, never the outline. `pixel lint` finds broken steps (jaggies), thickened lines (doubles), and pinholes, with their pixels; the shading it cannot judge.
- **One light.** Every asset is shaded from the same light direction. When the engine lights the scene, assets carry their own few even shades and no strong baked lighting; the engine's light changes with the room, and gameplay signals stay at full brightness under it.

### Motion

- **Key poses first, few frames.** The motion reads from its key frames alone; in-betweens add smoothness, not energy, and too many make it sluggish. One frame of wind-up makes an action readable; the area stays the same frame to frame (a squash widens as it flattens). Timing and effects follow the `ritmo-fx` skill's Craft.

### Judging

- **Judge in the game, at display size, on the target screen.** A sprite is one piece of a crowded screen: look at captures of real scenes at display size, on the smallest screen the game targets, under the game's lighting if it has any, still and in motion, before anything goes in. Squint: the shapes that matter must still be there. A zoomed-in canvas shows the pixels, not the read. When the target screen is out of reach, say so; the person who plays judges there.
- **A reference is a set of named qualities, not a picture to copy.** Say what the reference gives (scale, proportion, palette, mood, detail level) and what the game keeps regardless; say what is not wanted too. Change what was asked for and nothing else, and show two or three options at display size and zoomed 4× beside the reference and in a game capture before integrating one.
- **An exception is a decision, written down.** A second pixel size, a rotating sprite, a smooth parallax, a broken constraint: each is fine when the person chooses it for a reason and the game's design notes say why, and wrong when it happens to one asset. A clean lint, or two agents agreeing, never settles a look; the person who plays does.

## Rounds

You cannot see a sprite at the player's size, nor watch an animation play: you write a brief, draw, measure, and read still pictures; the person looks and decides. Quality comes from rounds of their notes, not from a first draft.

1. **Write the brief before the first pixel**, in the game's design notes: what the piece is and where it is seen, its size next to the player, the silhouette that tells it apart, each material and the ramp it is drawn from, the one light, and the reference as named qualities, with what is not wanted. For a set (a tileset, a cast), one brief covers it. The next piece reads the brief as written, word for word, not a summary of it, so the second asset matches the first.
2. **Draw or fix** with the case that fits ([Pick the case](#pick-the-case)).
3. **Check** every piece: `pixel lint` (or the report of `render`, `fix`, and `sheet`). Fix every error. Each warning names its pixels in `at` (with the frame, in an animation): fix it, or, when it is the look you want, add it to the file's `accept` in `pixel.config.json` with why (`"accept": {"art/torch.png": {"doubles": "the flame's tip is two pixels on purpose"}}`). Errors cannot be accepted. A change made only to quiet a check (a highlight deleted, an outline broken) is a new fault, not a fix.
4. **Look** with `pixel look` at every piece of the scene together, and read the picture it writes: on top, the pieces at display size on the game's backdrop beside its player (`scale`, `backdrops`, and `standIn` in the config); below, each frame up close, with every warning's pixels ringed in magenta. Judge the top first: does each piece read at a glance, at its size, in one style with the others? Fix what reads wrong before the person sees it.
5. **Read motion as numbers.** On a sheet, the report's `motion` gives the body's area per frame, the steps of the foot on the ground, and `ground.pixelsPerSecond`, the speed the game moves the sprite at so that foot stays planted; `area`, `skate`, and `seam` warn where it breaks.
6. **Show the person** two or three options at display size ([Judging](#judging)), in a game capture when the game runs; act on every note, and go back to 3.

## From a reference

A detailed reference (a photo, a render, a drawing) is never shrunk into a sprite: shrinking copies its pixels, and at a game's sizes that is noise, the photo's lighting turns to mud, and the parts that make the thing recognizable get no more pixels than the rest. Decide what the sprite is made of, then draw that.

1. **Name the subject, its view, and the sizes it must work at**, from the brief (with no game yet, write the brief beside the plan).
2. **List its parts, back to front, and rank them.** Tier 1 names the object: what a player who never saw the reference needs to recognize it (a motorcycle's two wheels, engine, tank, and seat; a face's eyes). Tier 2 supports it; tier 3 is detail. The ranking is the design: when you are unsure what names the subject, or the subject is the person's own (their character, their logo), ask the person before measuring. When you cannot ask, rank it yourself, write the ranking and why in the brief, and say so when you hand the art over.
3. **Measure each part on the reference** as one simple shape in the reference's pixels (a ring, an ellipse, a polygon, a line, a path), with a material, in a parts plan (the package's README describes its fields and what each material does). Give a part its own color when the reference's lighting would mislead (a white rocket at dusk is still white): a given color keeps its lightness, and the material sets only its shading. Mark a side where the subject is cut off (a bust at the chest) as `cut`, or it gets an outline there. Keep the plan next to the art: a new size or a fix is a redraw from it, not a new drawing.
4. **`pixel parts plan.json --sizes ...`** draws every size and the plan over the reference. Read the overlay first: each shape on its part, nothing that names the subject missing (a shape outside the reference is cut off there). The report says why each part left out was left out. Fix the plan, not the pixels.
5. **`pixel look` the sizes the game uses.** A size that does not read as the subject at a glance gets a different plan (a part's tier, shape, or color), drawn again. The smallest sizes often need a plan of their own: fewer parts, and the ones that name the subject drawn bigger than they measure. Hand edits in a size's sprite source come last, in a copy (drawing again overwrites `parts`' files), then `render` the copy.

## What you see, and the usual fix

| You see (at display size, or in the person's notes) | Fix |
| --- | --- |
| Mush: the piece does not read at a glance | Fewer colors and bigger clusters; a clear silhouette first, details after. |
| "Off-pixel": a piece looks drawn at another size | Redraw it on the game's grid; never scale it. |
| A piece looks like two materials glued together | One ramp in different values for the whole material. |
| Hairline cracks, scratches, or folds | Clusters the size of the characters' details. |
| Flat or pillowy | Shade from the one light, not from the outline inward. |
| Decoration fights the player for attention | Less value contrast and saturation in the backdrop; keep the strongest for what the player must notice. |
| Every tile busy, or the floor a void | Quiet base tiles, with rare details clustered where the world wears. |
| A sprite from a reference is noise, or does not look like the thing | Draw it from a parts plan ([From a reference](#from-a-reference)); fewer parts at that size, and more pixels for the ones that name it. |
| Colors as muddy as the photo | The part's own color and material in the plan, not the photo's light. |

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

A `pixel.config.json` at the game's root (`pixel init -p <palette>` writes one) holds the palette, the allowed sizes, the color limit, and whether the background must be transparent; how the game shows its art, for `pixel look` (`scale`: its whole number on the smallest target screen; `backdrops`: colors or floor tiles by name; `standIn`: the player's sprite); and the warnings judged deliberate (`accept`, per file, each with why). Every command reads it from the working directory up, so never repeat them on the command line; change the config instead when the rules change. `pixel palettes` lists the presets.

### Pick the case

- **Drawing a sprite with code.** Write a sprite source (below), then `pixel render sprite.txt --scale 8`: it writes `sprite.render.png`, `@8x.png`, `.svg`, and `.preview.png` (or the name `-o` gives), and lints the art. Fix every error in the source, never in the PNG. The preview shows the pixels; `pixel look sprite.txt` shows it at display size beside the player, and whether it reads is judged in a game capture ([Judging](#judging)).
- **A picture from an image generator.** `pixel check pic.png` first. `fixable` → `pixel fix pic.png` writes the true-size `.png`, `.svg`, a JSON map, a `.sprite.txt` (to edit by text), its `.recipe.json`, and a `.preview.png` (the source and its grid beside the fix). Add `--colors N` when there is no palette, `--remove-background` for a sprite, `--cleanup 1` against noise specks.
- **An animation sheet from an image generator** (frames side by side in boxes, often labelled). `pixel sheet sheet.png --colors 16` clears the background and labels, finds the frames, fixes them on one grid and palette, lines them up (by default on the ground: sideways drift removed, hops kept; `--anchor feet` pins the feet to one row), and writes the sheet `.png` and its `.json` (Pixi, Phaser, Aseprite), a `.gif` per animation, `.frames/`, the recipe, and a `.preview.png`. Each row of frames is one animation (`animation-1`, ... in reading order; `animation.animations` in the report lists each one's frame numbers): name them and keep the ones the game uses with `--animations "walk-down=1-4;throw-down=5-8;explode=29-38"` (every frame in one; a row that is not one animation is split or joined here) and `--only walk-down,explode`, then play them by name from the JSON's `animations`. Open the preview: each frame's box must hold the whole frame, and each animation's boxes share a color. Pass `--boxes "x,y,w,h;..."` when one is cut, `--skip 3` to leave a bad frame out, `--anchor center` for things that float, `--fps` and `--pingpong` for the timing, and `--columns N` for rows. Look at each `.gif` before using it.
- **A reference (a photo, a render, a drawing) to turn into game art.** Write a parts plan and `pixel parts plan.json --sizes 16,32,64` ([From a reference](#from-a-reference)): each size's `.png` and sprite source, the plan over the reference (`.overlay.png`), and per size the parts kept, left out, and enlarged to read. `pixel pixelate ref.png -w 32` only cuts a picture that is already as simple as the sprite (flat colors, few shapes, close to the target size) into pixels.
- **Checking assets before they ship.** `pixel lint` each PNG at its true size and each sheet's `.json` (exit 0 for all of them, every warning fixed or accepted), or `pixel check` for pictures that may be upscaled. `pixel look` the pieces that share a scene, together. `pixel compare a.png b.png` says which of two versions is better and why.

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
