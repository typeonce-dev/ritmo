---
"@typeonce/ritmo-tools": minor
"@typeonce/ritmo": patch
---

`ritmo-tools fx`: ramps, recolor, palette editing, a stand-in sprite, draft comparison, and reach across seeds.

- A bank's `ramps` name fades through its palette (`"fire": ["white", "yellow", "orange", "red"]`), and drafts draw with them by name: `fx.ramp("fire", v)`. A draft's `recolor` draws one ramp with another's colors (`{"fire": "frost"}`), so a blue fire is the same file with one line in the bank; the review page's Tune section picks it too. A ramp the bank does not have is an error.
- A bank's `standIn` is a PNG of one of the game's sprites with the pixel at its feet (`{"file": "art/hero.png", "anchor": [10, 45]}`). The page and `fx look` draw it behind every effect, so its size reads against a body. It stands on the effect's anchor, moved by the effect's `standIn` offset (`[0, 24]` for a hit's target), or not at all with `false`. `fx look --alone` and the page's Background section leave it out.
- `fx look --compare` writes one picture of every draft of an effect, a row each, the same moments in each column, to weigh the drafts against each other.
- `fx check` also runs each draft with seeds 2, 3, and 7, and warns (`clipped-seed`) when the draft's own seed keeps it inside the canvas only by luck.
- The review page's Palette section lets the person change the bank's colors (picked from the project's `pixel.config.json` palette when it has one) and its ramps (steps picked, reordered, added, removed; new ramps), for every effect at once. `fx notes` lists the palette and ramps as they are now.
- New shapes: `fx.oval` and `fx.ovalRing` (ellipses with clean steps, for pools and shock rings flat on the floor), `fx.sparkle` (a star glint), and `fx.streak` (a moving spark's trail along a ramp).

The `ritmo-fx` skill adds the bank's stand-in and ramps to its loop, `--compare` before showing drafts, open-source effects to read for choreography, phases with a white hero frame, and a table of what you see and the usual fix.
