---
name: pixel-art
description: "Apply whenever a game's pixel art is made, changed, or checked: a sprite drawn with code, a picture from an image generator, a reference image to turn into game art, or assets checked before they ship. Says which pixel command to run for each case and how to read its report."
---

# Pixel art with the `pixel` CLI

`pixel` (`tools/pixel-fixer` in the Ritmo repository; `node <ritmo>/tools/pixel-fixer/bin/pixel.mjs`) checks, fixes, and makes pixel art. Every command prints a JSON report on stdout and exits with what to do next:

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

A recipe holds every setting of a fix, the grid and hand edits included. `pixel fix` writes one next to its outputs, the web page saves one (**Recipe**), and `--recipe file` runs it: the same picture with the same recipe fixes the same way in both. When a person must finish a fix by hand, give them the picture and its recipe; when they send back a recipe, rerun with it.
