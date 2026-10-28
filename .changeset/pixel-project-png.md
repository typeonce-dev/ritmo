---
"@typeonce/ritmo-tools": minor
"@typeonce/ritmo": patch
---

`ritmo-tools pixel`: project PNGs. A project PNG is the source picture with its recipe stored inside (one uncompressed `iTXt` chunk, keyword `ritmo-pixel-recipe`; the pixels are untouched), so one file reopens a whole session. The web page exports one (Export → **Project PNG**, for pictures and animation sheets) and restores every setting when it opens one. `pixel fix --project` writes `<name>.project.png`, and `check`, `fix`, `sheet`, and `preview` run the recipe a project PNG holds (a `--recipe` file wins over it; the report says `"storedRecipe": true`). A project PNG is not a game asset: `exiftool -all=` or `oxipng --strip safe` turns it back into the plain picture.

Grid detection finds cells that a screenshot or resize stretched a few percent on one axis, instead of falling back to a fraction of the cell (a sprite came out 25×68 instead of 28×32).

The `ritmo-pixel-art` skill says when to hand a person a project PNG, and how to spot and strip one.
