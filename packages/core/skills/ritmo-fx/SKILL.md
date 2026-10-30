---
name: ritmo-fx
description: "Apply whenever a game's pixel art effects (hits, explosions, fire, magic, pickups, dashes) are made, changed, or reviewed with a person. Says how to write effects as code drafts in a bank, check and look at them with `ritmo-tools fx`, open the review page, act on the person's notes and pinned comments, write sprite sheets for the game, and the pixel art craft the checks measure."
---

# Pixel art effects with `ritmo-tools fx`

`ritmo-tools fx` keeps a game's effects as code: each effect has a few drafts, each draft a small JavaScript module that draws one frame at a time with the palette's color names. A bank file (`game.fx.json`) names the palette, its ramps (`ramps`), the game's backgrounds (`backdrops`), one of its sprites to judge size by (`standIn`), and every effect's drafts. It ships in `@typeonce/ritmo-tools`: run it as `npx @typeonce/ritmo-tools fx <command>`. Below, `fx <command>` stands for that; `fx <command> --help` lists every flag, and the package's README describes the module format and everything `draw(fx)` gets. Every command prints JSON and exits 0 (clean; warnings are your call), 2 (usage error, missing file, broken bank: read `problems`), or 3 (errors: fix them).

You cannot watch an effect play. You write, measure, and look at still frames; the person watches and decides. Quality comes from rounds of their picks and notes, not from your first draft.

## The loop

1. **Ask for references first**: which game, film, or picture the effect should feel like, and its size next to the player. Put what they say in the effect's `about`. Put the game's real backgrounds in the bank's `backdrops`, so every check and the page use them, and its player (or the target) as the bank's `standIn`, so you and the person see every effect at its size next to a body; give each effect the `standIn` offset that stands it where it belongs (a hit's target below the blow), or `false`. For choreography and numbers, read open-source effects close to the one asked for: [Sprite Fusion's pixel art VFX](https://www.spritefusion.com/pixel-art-vfx) and [pixelfx](https://github.com/patch-gg/pixelfx) (both MIT; they draw with glow and translucency, which `fx` does not, so take their timing and shapes, not their blending).
2. **Write several first drafts that differ in idea**, not in numbers (a starburst, a slash, a shock ring), each in its own module with a `label`. Leave the numbers the person may want to change as `params` with a range. Seeds and params vary a draft; drafts vary the idea. Draw every fade through one of the bank's `ramps` by name (`fx.ramp("fire", v)`), so a draft recolors without new code: a blue fire is a draft entry with `"recolor": {"fire": "frost"}` on the same file.
3. **Check** with `fx check <bank>`. It reads the project's `pixel.config.json`, so effects keep the sprites' palette and color limit. Fix every error. For each warning with `at`, see the spots with `fx look <bank> <effect> --draft <id> --marks <code>` (they are ringed in magenta), then fix it, or, when it is the look you want, add it to the draft's `accept` with why (`"accept": {"jaggies": "the notches where puffs overlap are the cloud look"}`). Errors cannot be accepted.
4. **Look** with `fx look <bank> <effect>`, and read every contact sheet it writes (frames left to right, top to bottom, from frame 0). Fix what reads wrong before the person sees it. `fx look <bank> <effect> --compare` puts every draft in one picture, a row each at the same moments: weigh them against each other there, and drop or rework the weakest before the person sees them.
5. **Open the review**: `fx review <bank>` (add `--host` for a phone; it runs until stopped, so start it in the background) and send the person the `url` it prints. Tell them which effect to look at and what each draft tries, and that they can click a pixel to pin a comment to it.
6. **Read back** with `fx notes <bank>`: each effect's status, note, open comments (each numbered, on a draft, a frame, and a pixel), the draft in `use`, its `tune`, and the bank's palette and ramps as they are now (the person can change a color or a ramp on the page, for every effect at once; keep their choice). `fx look` rings each open comment's pixel on its frame: look before you change anything. Act on every note and comment, then mark each comment done with `fx resolve <bank> <effect> <numbers...> --reply "what changed"`, so the person sees what you did beside it and the next round shows only what is still open. Go back to 3. Drop drafts the person ruled out.

## Rules

- Never call an effect done because it checks clean: only the person's `approved` says it looks right. Ask for their eyes on motion and timing; a check cannot judge them.
- Keep the person's `tune` when you change a draft, unless their note asks otherwise; fold it into the module's own values only when they agree.
- `draw` is a function of the frame, not a simulation: get each particle's direction, speed, and delay from `fx.random()` (its n-th number is the same in every frame) and its place from `fx.t`. A loop wraps when everything moves on `fx.t` with whole cycles.
- Give every draft an `anchor`: the pixel the game places on the effect's spot (where the blow lands, the caster's feet, a torch's foot). The middle of the canvas is right only for effects centred on their spot.
- `fx render <bank> -o <dir>` writes each effect's draft in use as a sprite sheet PNG, its JSON (Pixi, Phaser, and Aseprite read it; each frame's `anchor`, and `meta.loop` for whether it loops), and a GIF. The game plays the sheet at the anchor; it never runs a draft's code.

## Craft

- **Edges step evenly.** Along a curve, the runs of pixels grow or shrink steadily; a short run between long ones (a jaggy) breaks the line. Shapes from `fx.disc` and `fx.ring` step evenly; edges you compute pixel by pixel (test each pixel against the shape) step more evenly than edges you trace by stepping along an angle.
- **One-pixel lines stay one pixel.** A pixel in the corner of an L (a double) makes a thin line look thick there. Two outlines a pixel apart leave pinholes between them: use `fx.ring`'s width, or a disc, for a thick ring.
- **No in-between colors against a background.** Effects play over many backgrounds, so they never blend into one: keep to the palette, and give a bright effect a darker edge (or a dark one a lighter edge) where a `backdrops` check finds it faint.
- **Fade along one ramp per material.** Fire cools from white through yellow and orange to red and smoke; magic cools along its own. Shift the hue as a ramp darkens (warmer as it brightens), and reuse the same ramp across a family of effects.
- **Choreography in phases.** Gather (a charge, things drawn in), release (one or two frames of white, the hero frame), spread, hold (glints, embers), and a long decay; small events in each, varied in size, speed, and timing. A hit can skip the gathering; it never skips the hero frame.
- **Fast in, slow out, and frames are weight.** An impact lands at once and lingers as it fades: spend frames on the ends, not the middle. A heavier blow is more frames and a held pose, not a bigger one alone. Exaggerate a little more than real.
- **Still parts stay still.** A shape that should hold must draw the same pixels every frame. Positions rounded differently frame to frame, or shapes handing over every other frame, make it boil (the flicker warning).

## What you see, and the usual fix

| You see | Fix |
| --- | --- |
| Mush at 1× | Fewer colors, a clear silhouette, one focal point, bigger shapes. |
| Speckle: lone pixels inside shapes | No noise on small shapes; group pixels into runs and clusters. |
| Floaty, no punch | Fast in, slow out (`fx.ease.out`), a white hero frame, a shorter whole. |
| Stiff, mechanical | Vary every particle (size, speed, delay, life); add secondary motion (sparks, dust, debris). |
| Flat | Light from one side: a paler step on top, a darker one below. |
| A one-shot that pops off | Let it shrink or fall away before the last frame. |
