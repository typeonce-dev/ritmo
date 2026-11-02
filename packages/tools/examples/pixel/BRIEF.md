# Pixel art samples: one round of the `ritmo-pixel-art` workflow

A small top-down dungeon room, made the way the skill's Rounds say: the brief
below came first, then each piece was drawn as a sprite source (or fixed from
an image generator's sheet), checked with `pixel lint`, and looked at with
`pixel look`. `pixel.config.json` holds the rules every command reads.

```sh
# from this folder
node ../../bin/ritmo-tools.mjs pixel render hero.txt -o hero     # draw, and lint
node ../../bin/ritmo-tools.mjs pixel sheet fire-spirit-run.jpg --skip 6 --animations "run=1-7" --anchor center -o fire-spirit
node ../../bin/ritmo-tools.mjs pixel look hero.txt slime.txt chest.txt fire-spirit.json -o look.png
```

`look.png` is the picture an agent reads before a person sees anything, and
`look.report.json` what the checks said beside it.

## The brief

- **The game.** Top-down, a 16×16 grid, shown at 4× on the smallest phone
  (`scale: 4`). The smallest detail that must read is the player's eyes.
- **Read order.** The slime (it hurts) first, then the player, then the
  chest, then the floor. The slime has the most saturated color on screen;
  the floor is dark, quiet blue stone that recedes.
- **The one light.** From the top left: lit tops and left faces, shadow on
  the right and underneath.
- **The characters set the rules.** A 1-pixel outline in the darkest color
  (`#1a1c2c`) on the player, the slime, and the chest; the floor has none.
  Two to three shades per material.
- **Palette.** Sweetie 16. Ramps: skin `#ffcd75` → `#ef7d57`; the player's
  tunic `#41a6f6` → `#3b5dc9` → `#29366f` (blue belongs to the player
  alone); slime `#a7f070` → `#38b764` → `#257179` with a `#f4f4f4` glint;
  wood `#ef7d57` → `#b13e53` → `#5d275d` with `#94b0c2` bands; stone
  `#566c86` → `#333c57` with `#1a1c2c` joints.
- **Pieces.**
  - `hero.txt`: the player, the stand-in. Silhouette: a big head with a
    cap of hair over a short body; facing down.
  - `slime.txt`: the threat. Silhouette: a low dome, wider than tall.
  - `chest.txt`: a prop. Silhouette: a box with a lid, wider than tall.
  - `floor.txt`: the floor tile. Bricks that loop on all four sides, no
    details on the base tile (detail goes in variants, placed rarely).
  - `fire-spirit-run.jpg`: an image generator's run cycle, fixed onto the
    palette with `pixel sheet`, to try the sheet path. Not wanted: a second
    pixel size, or a creature bigger than the player unless it is a boss.

## What the round found

- `hero.txt`: two lone pixels on the boots (fixed: the boots are two
  pixels wide now) and the eyes (accepted in the config: single dark pixels
  on purpose).
- `slime.txt`, `chest.txt`, `floor.txt`: clean. The floor's base tile had
  three small wear marks; at display size they repeated on every tile and
  showed the grid, so they were taken out.
- `fire-spirit.json`: the size check fails (31×36 against the 16×16
  grid): the generated spirit is twice the player's size, which `look.png`
  shows on its top row. It also boils (4% of its pixels blink for one
  frame) and has uneven steps along its outline. Next round: generate it
  at the game's size, or make it a boss with the size written into the
  brief.
