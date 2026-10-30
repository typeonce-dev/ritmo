---
"@typeonce/ritmo-tools": minor
"@typeonce/ritmo": minor
---

`ritmo-tools fx`: pixel art effects as code. Each effect in a bank (`game.fx.json`) has a few drafts, each a small JavaScript module that draws one frame at a time with the palette's color names (`fx.px`, `fx.line`, `fx.disc`, `fx.ring`, `fx.ramp`, `fx.random()` from the draft's seed), and params the person can tune. Circles are drawn as pixel artists draw them: no doubles, even steps, and `fx.ring` takes a width with no pinholes.

`fx check` runs every draft and lists what an agent cannot see by reading code, with the frames and pixels where: errors (a module that does not load or throws, nothing drawn, randomness not from the seed, colors outside the project's `pixel.config.json` palette or over its `maxColors`) and warnings (cut off at the canvas edge, a one-shot that starts late or does not end empty, a loop that jumps, blinking, lone-pixel noise, jaggies, doubles, pinholes, flicker, and an effect too faint on one of the game's backgrounds, listed in the bank's `backdrops`). A draft's `accept` records a warning judged deliberate, with why. `fx look` writes a contact sheet of every frame for the agent to look at, with the person's comments or a rule's spots ringed. `fx review` opens a local page where a person watches the drafts side by side, slowed down or frame by frame, picks one, tunes it, and clicks a pixel to pin a comment to it; `fx notes` reads it all back. `fx resolve` marks comments done with a reply the person sees. `fx render` writes the chosen draft as a sprite sheet PNG with its JSON (Pixi, Phaser, Aseprite; each frame's anchor from the draft's `anchor`, and `meta.loop`) and a GIF. The page also runs on the website with an example bank: https://ritmo.typeonce.dev/tools/fx/.

`@typeonce/ritmo` ships a new skill, `skills/ritmo-fx`, with the pixel art craft the checks measure. Link it next to the others:

```sh
ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-fx .agents/skills/ritmo-fx
```
