---
name: ritmo-pixel-art
description: "Apply whenever a game's pixel art is made, changed, or checked: a sprite drawn with code, a picture from an image generator, a reference image to turn into game art, or assets checked before they ship. Says which `ritmo-tools pixel` command to run for each case and how to read its report."
---

# Pixel art with `ritmo-tools pixel`

`ritmo-tools pixel` checks, fixes, and makes pixel art. It ships in `@typeonce/ritmo-tools`: run it as `npx @typeonce/ritmo-tools pixel <command>` (add the package as a dev dependency to pin it to the game's Ritmo version). Below, `pixel <command>` stands for that. `pixel <command> --help` lists every flag, and the package's README explains the pipeline. A person tunes the same fixes by hand on the web page, https://ritmo.typeonce.dev/tools/pixel/.

Every command prints a JSON report on stdout and exits with what to do next:

| Exit | Verdict | Do |
| --- | --- | --- |
| 0 | `clean` (or fixed with confidence) | Use the file. |
| 2 | usage error, missing file, broken sprite source | Read stderr, or `problems` on stdout (each with its line), and correct the call or the source. |
| 3 | `fixable`: rules broken | Run `pixel fix` (a picture) or edit the source (a sprite), then check again. |
| 4 | `needs-person`: the grid is unsure | Open `<name>.preview.png`; give the grid with `--cell` and `--offset` if you can read it, or hand the recipe to the person (it opens in the web page). Never ship a needs-person fix as done. |

## The project's rules

A `pixel.config.json` at the game's root (`pixel init -p <palette>` writes one) holds the palette, the allowed sizes, the color limit, and whether the background must be transparent. Every command reads it from the working directory up, so never repeat them on the command line; change the config instead when the rules change. `pixel palettes` lists the presets.

## Pick the case

- **Drawing a sprite with code.** Write a sprite source (below), then `pixel render sprite.txt --scale 8`: it writes `.png`, `@8x.png`, `.svg`, and `.preview.png`, and lints the art. Fix every error in the source, never in the PNG. Look at the preview: whether it reads well is yours to judge.
- **A picture from an image generator.** `pixel check pic.png` first. `fixable` → `pixel fix pic.png` writes the true-size `.png`, `.svg`, a JSON map, a `.sprite.txt` (to edit by text), its `.recipe.json`, and a `.preview.png` (the source and its grid beside the fix). Add `--colors N` when there is no palette, `--remove-background` for a sprite, `--cleanup 1` against noise specks.
- **An animation sheet from an image generator** (frames side by side in boxes, often labelled). `pixel sheet sheet.png --colors 16` clears the background and labels, finds the frames, fixes them on one grid and palette, lines them up (by default on the ground: sideways drift removed, hops kept; `--anchor feet` pins the feet to one row), and writes the sheet `.png` and its `.json` (Pixi, Phaser, Aseprite), a `.gif` per animation, `.frames/`, the recipe, and a `.preview.png`. Each row of frames is one animation (`animation-1`, ... in reading order; `animation.animations` in the report lists each one's frame numbers): name them and keep the ones the game uses with `--animations "walk-down=1-4;throw-down=5-8;explode=29-38"` (every frame in one; a row that is not one animation is split or joined here) and `--only walk-down,explode`, then play them by name from the JSON's `animations`. Open the preview: each frame's box must hold the whole frame, and each animation's boxes share a color. Pass `--boxes "x,y,w,h;..."` when one is cut, `--skip 3` to leave a bad frame out, `--anchor center` for things that float, `--fps` and `--pingpong` for the timing, and `--columns N` for rows. Look at each `.gif` before using it.
- **A reference image (a drawing, a render, a photo) to turn into game art.** `pixel pixelate ref.png -w 32` cuts it into 32 pixels across on the project's palette (or `--colors N` proposed from the picture). Pixelating loses detail by design: compare widths by their previews, keep the smallest one that still reads, then touch up the `.sprite.txt` and `render` it.
- **Checking assets before they ship.** `pixel lint` each PNG at its true size (exit 0 for all of them), or `pixel check` for pictures that may be upscaled. `pixel compare a.png b.png` says which of two versions is better and why.

## Sprite sources

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

## Recipes

A recipe holds every setting of a fix, the grid and hand edits included. `pixel fix` writes one next to its outputs, the web page saves one (**Recipe**), and `--recipe file` runs it: the same picture with the same recipe fixes the same way in both. When a person must finish a fix by hand, `pixel fix pic.png --project` writes `pic.project.png`: the picture with the recipe inside, which opens in the web page with every setting. A project PNG the person sends back runs as it is: `pixel fix pic.project.png` uses the recipe it holds (`"storedRecipe": true` in the report).

A project PNG is never a game asset: ship the fixed `.png`. To spot one, `grep -a ritmo-pixel-recipe file.png` (the recipe is an uncompressed `iTXt` chunk with that keyword); to make it a plain picture, `exiftool -all= file.png` or `oxipng --strip safe file.png`.
