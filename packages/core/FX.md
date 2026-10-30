# Why the `ritmo-fx` skill says what it says

This file is for the maintainers and the agents working on this repo. It is not published: `package.json` `files` leaves it out (`pnpm pack:check` fails if it ships), and the website does not read it.

Every rule in [`skills/ritmo-fx`](skills/ritmo-fx/SKILL.md) traces back to one of two things:

- **Practice:** advice from pixel artists and animators, quoted below with a link.
- **Ritmo:** how `ritmo-tools fx` works, or a direction from the maintainer. These are conventions, not craft claims, and are marked as such.

A rule that is neither does not go in the skill. When you change the skill, change this file in the same commit. Quotes were checked against the text of the linked page on 2026-10-30.

## The loop

### Drafts that differ in idea, picked and refined in rounds; the person sets the bar; references first

- Hugo, "How to make (good) pixel art effects with Claude", Sprite Fusion, 2026 ([link][spritefusion]): "Then let your agent write 5–10 first drafts and render them as short videos" … "Then pick one to dig into, refine its details, and repeat until you've narrowed it down" … "This is very important: it's on you to set the quality bar." … "Your taste is built from your references."
- The skill says "several" drafts, not a number: a fixed count makes every effect start from the same script (the same choice as `PROTOTYPE.md`).
- **Ritmo:** the agent looks at contact sheets (`fx look`) where the article renders videos, because an agent reads still pictures, and the person watches the motion on the review page.

### Read open-source effects for choreography and numbers

- Hugo, Sprite Fusion ([link][spritefusion]): "Your taste is built from your references."
- Patch, pixelfx `docs/AUTHORING.md` ([link][pixelfx-authoring]): "Reference first. Find the closest of his effects, look at it, and read its source for the choreography and numbers."
- **Ritmo:** the skill says to take timing and shapes, not blending: `fx` draws opaque palette colors only (see "No in-between colors" below), and both libraries glow and blend.

### A stand-in sprite for size

- Patch, pixelfx `README.md` ([link][pixelfx]): "A 24×38 stock character stands in for status effects, auras and hits."
- **Ritmo:** the stand-in is the game's own sprite, from the bank, not a stock one, so the size it shows is the game's.

### Compare drafts at the same moments

- Patch, pixelfx `tools/compare.mjs` ([link][pixelfx-compare]): "Drafts side by side: one row per effect, the same moments in each column, so you can pick the best."

### Fades through named ramps, so drafts recolor

- Patch, pixelfx `README.md` ([link][pixelfx]): "Any effect takes a `palette` (a dark-to-bright ramp of hex colors), so a fire can burn blue and a heal can glow pink without touching its code".
- **Ritmo:** ramps are palette names in the bank, not hex colors in the effect, so a recolor keeps to the project palette; see "Fade along one ramp per material" below for the craft.

### Check before showing; accept a warning only with a reason

- **Ritmo:** the same rule as the repo's lint (`// oxlint-disable-next-line ritmo/<rule> -- <reason>`): a judged exception is written down with why, and errors are never waived.

### Resolve each comment with a reply

- **Ritmo:** the same loop as the other labs' notes, closed: the person sees what changed beside their own words, and the agent's next `fx notes` lists only what is still open.

### Every draft has an anchor

- **Ritmo:** the sprite sheet's JSON carries each frame's anchor (the format the pixel fixer writes), and a game places an effect by it; an effect that is not centred on its spot needs its own.

### Effects keep the sprites' palette

- **Ritmo:** one `pixel.config.json` per project holds the art rules, and `fx check` reads it, as every `ritmo-tools pixel` command does.

## Craft

### Edges step evenly (jaggies)

- Derek Yu, "Pixel Art Tutorial" ([link][yu]): "reducing the number of jaggies: single pixels or small segments of pixels that break up the consistency of a line." … "With curved lines, jaggies crop up when the length of the line segments don't grow or shrink in a consistent manner." … "it's impossible to avoid them entirely unless your pixel art is made only of the simplest shapes."
- The last quote is why jaggies are a warning that can be accepted, and why `fx check` warns only from three spots in a draft.

### One-pixel lines stay one pixel (doubles), and no pinholes

- Derek Yu ([link][yu]): "clean up the outline by removing stray pixels and reducing every line to a single pixel in thickness."
- Ken Lo, GSoC 2024 status report on Krita's pixel-perfect mode, describing the LibreSprite code it follows ([link][kenlo]): "There is a conditional check designed to skip over points that would visually form a corner in an L-like shape."
- `fx.ring` draws the midpoint circle with those corner points taken out; `doubles` in `fx check` finds the same pattern.
- **Ritmo:** pinholes (two outlines a pixel apart) were found on this repo's own example drafts; the `holes` check and `fx.ring`'s width came from that.

### No in-between colors against a background

- Derek Yu ([link][yu]): "If, for example, you anti-alias on a light background then that anti-aliasing will stand out on a dark background."
- **Ritmo:** the runner draws only opaque palette colors, so effects cannot anti-alias; the bank's `backdrops` and the `contrast` check cover the other half, an effect that vanishes on one of the game's backgrounds.

### Fade along one ramp per material, hue-shifted

- Raymond Schlitter (Slynyrd), "Pixelblog 1: Color Palettes", 2018 ([link][slynyrd]): "A good color ramp should also apply hue-shifting, which is a transition in hue across the color ramp." … positive hue shift "usually results in more natural colors, warming as they become brighter."

### Fast in, slow out; frames are weight; exaggerate

- "Twelve basic principles of animation", Wikipedia, after Thomas and Johnston, *The Illusion of Life*, 1981 ([link][twelve]): "For this reason, more pictures are drawn near the beginning and end of an action, creating a slow in and slow out effect" … "Timing refers to the number of drawings or frames for a given action, which translates to the speed of the action on film." … on exaggeration: "animated motions that strive for a perfect imitation" of reality can look static and lifeless.

### Choreography in phases, with a hero frame

- Patch, pixelfx `docs/AUTHORING.md` ([link][pixelfx-authoring]): "Choreography in phases. Anticipation or charge (things gathering in), release (a 1 to 2 frame white hero frame, a flare, light, a burst), spread, hold (twinkles, glints, embers), break or melt, a long decay. Many small events, each varied in size, speed, timing and life."

### What you see, and the usual fix

- Patch, pixelfx `skills/pixelfx/SKILL.md` ([link][pixelfx-skill]), its table of what to look for: "it reads as mush at 1x | fewer colors, a clear silhouette, one focal point, bigger shapes"; "speckle: lone noise pixels inside shapes | threshold noise less, quantize with `at()`, no noise on small shapes"; "floaty, no punch | fast in, slow out (`ease.outQuart`/`outExpo`), a 1 to 2 frame white hero frame, shorter total time"; "stiff or mechanical | vary every particle (size, speed, delay, life), add secondary motion (sparks, smoke, debris)"; "flat | light from one side: brighter top-left, darker bottom-right step; …"; "a one-shot that pops off | let it shrink, dither out or fall away before t = duration".
- **Ritmo:** the skill keeps the rows that hold for opaque palette pixels, in `fx`'s terms; the rows about glow, translucency, and dithered smoke do not apply.

### Particles reach further on another seed (clipped-seed)

- Patch, pixelfx `tools/check.mjs` ([link][pixelfx-check]): "other seeds can throw particles further: look for spills with a few more".
- **Ritmo:** `fx check` uses the same seeds, 2, 3, and 7.

### Still parts stay still (boil)

- PremiumBeat, "How to Create Line Boil Animations" ([link][boil]): "Line boils occur when the images of a frame-by-frame animation don't align perfectly."
- **Ritmo:** the `flicker` check counts pixels that change for one frame and change back; its threshold (6%) was set on this repo's example drafts, where a boiling torch measured 22% and clean ones 0 to 5%.

[spritefusion]: https://www.spritefusion.com/blog/how-to-make-good-pixel-art-effects-with-claude
[yu]: https://www.derekyu.com/makegames/pixelart.html
[kenlo]: https://community.kde.org/GSoC/2024/StatusReports/KenLo
[slynyrd]: https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes
[twelve]: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
[boil]: https://www.premiumbeat.com/blog/how-to-create-line-boil-animations/
[pixelfx]: https://github.com/patch-gg/pixelfx
[pixelfx-authoring]: https://github.com/patch-gg/pixelfx/blob/main/docs/AUTHORING.md
[pixelfx-skill]: https://github.com/patch-gg/pixelfx/blob/main/skills/pixelfx/SKILL.md
[pixelfx-compare]: https://github.com/patch-gg/pixelfx/blob/main/tools/compare.mjs
[pixelfx-check]: https://github.com/patch-gg/pixelfx/blob/main/tools/check.mjs
