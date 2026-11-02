# Parts plans: sprites from a detailed reference

Each folder holds a reference, the parts plan measured on it, and what
`pixel parts` drew from the plan at 16, 24, 32, 64, and 128 pixels (the longest
side), with `look.png` (every size at display size, then up close) and the
plan over the reference (`*.overlay.png`).

```sh
# from a folder
node ../../../../bin/ritmo-tools.mjs pixel parts plan.json --sizes 16,24,32,64,128 -o cup
node ../../../../bin/ritmo-tools.mjs pixel look cup.16.png cup.24.png cup.32.png cup.64.png cup.128.png -o look.png
```

- `cup/`: an espresso cup on a saucer, seen from above. Tier 1 is the saucer,
  the cup, its handle, its white rim, and the coffee; the spoon and the cup's
  inside join at 32, the saucer's well and the crema's ring at 64. The
  porcelain and the crema are `plain` (the reference's own lightness), the
  inside and the coffee `hollow`. Weak below 32: the cup and the saucer are
  one red, so only a dark edge parts them.
- `rocket/`: a rocket on its launch pad. The body and the fairing give their
  own color (`#ecebe6`): the photo, taken at dusk, lights them beige. Tier 1 is
  the pad, the body, and the fairing; the support legs and the interstage band
  join at 32, the engines, the logo, and the pad's lights at 64.

The references come with scikit-image's sample data: the coffee photograph is
CC0 (Rachel Michetti, courtesy of Pikolo Espresso Bar; scaled down to a JPEG
here), and the launch photograph of DSCOVR on Falcon 9 was released into the
public domain by SpaceX.
