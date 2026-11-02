---
"@typeonce/ritmo-tools": minor
"@typeonce/ritmo": minor
---

`ritmo-tools pixel parts <plan.json>` draws pixel art from a detailed reference without copying its pixels. A parts plan names the subject's parts back to front, ranks them (tier 1 names the object, 2 supports it, 3 is detail), and gives each a simple shape measured on the reference (ellipse, ring, polygon, line, path) and a material. Each size keeps tier 1, adds tier 2 from 32 pixels and tier 3 from 64, enlarges what must read (a wheel keeps a ring with a hole), and draws with pixel rules: whole-pixel circles, clean lines, one light, ramps from the material with the part's hue, an outline on the outside only. A part given its own color keeps its lightness, and the material sets its shading; a plan's `cut` sides (a bust at the chest) get no outline; a size matching one of the project's sizes is drawn on that canvas. It writes each size's PNG and sprite source, and the plan over the reference to check the measures, and says why each part left out was left out. `pixel pixelate` is now for pictures already as simple as the sprite.

The `ritmo-pixel-art` skill turns a reference into game art this way ("From a reference"): name the subject and its sizes, rank its parts (asking the person when unsure what names it), measure them, read the overlay, then look at every size and change the plan, not the pixels.
