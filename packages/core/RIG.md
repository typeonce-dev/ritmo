# Why the `ritmo-rig` skill says what it says

This file is for the maintainers and the agents working on this repo. It is not published: `package.json` `files` leaves it out (`pnpm pack:check` fails if it ships), and the website does not read it.

Every rule in [`skills/ritmo-rig`](skills/ritmo-rig/SKILL.md) traces back to one of four things:

- **Practice:** advice from animators and the makers of skeletal animation tools, quoted below with a link.
- **Review:** what the maintainer said on the review page about the first clips of the example swordsman (October 2026), quoted from the review file. Each note became a rule because the first drafts broke it.
- **Prototype:** what the agent that made those first clips, in the prototype `ritmo-tools rig` grew from, wrote down as hard for it (October 2026), quoted from its notes.
- **Ritmo:** how `ritmo-tools rig` works, or a direction from the maintainer. These are conventions, not craft claims, and are marked as such.

A rule that is none of these does not go in the skill. When you change the skill, change this file in the same commit. Quotes were checked against the text of the linked page on 2026-11-01.

## When a rig fits

### Side-view characters made of parts, about 64 px and up

- Esoteric Software, Spine user guide, "Basic concepts" ([link][spine-concepts]): "A skeleton has a hierarchy of bones." Every clip of a character poses the same bones and the same parts.
- **Ritmo:** the rasterizer draws parts anti-aliased, and a part needs room for its outline and its turn to read: the size is the maintainer's direction, from the example bank (a 264×212 frame) and the brawler.

### Not small pixel sprites

- **Ritmo:** a rig keeps no pixel grid and no palette (`rig parts` keeps the pixels "as drawn, anti-aliased: there is no grid snapping and no palette", the README says); a pixel sprite's frames are fixed onto its grid by `ritmo-tools pixel`, which the `ritmo-pixel-art` skill drives.

### Not the hand-drawn, frame-by-frame look

- **Ritmo:** a bone turns in the picture's plane only, and a part is one flat picture or shape drawn in the side view (`rig parts`' limits: "a side view, one character facing right, each part drawn whole"). A torso twisting or hips turning toward the camera need new drawings, which a rig does not have. The maintainer's direction for the skill.

## From a parts sheet

### Name, cut, and check the pivots before scaffolding; the module owns them after; a weapon on its own bone, held two-handed by a second reach

- **Ritmo:** procedure for `rig parts` and `rig init --from` (their README section). The steps and the two-handed pattern come from the evaluation run in which a fresh agent rigged Borri (`examples/rig/borri/`) from `examples/rig/sheet/character.png` with only this skill and the README: it reported that the pivot guess is wrong for a weapon lying on its side, that correcting pivots in `parts.json` after `init` meant editing two places, and that a far hand could not reach a weapon on the near hand. The scaffold now puts the weapon on a bone of its own before the arms, and the module owns the pivots after `init`.

## The loop

### References first; key poses in words before code

- Hugo, "How to make (good) pixel art effects with Claude", Sprite Fusion, 2026 ([link][spritefusion]): "Your taste is built from your references."
- "Twelve basic principles of animation", Wikipedia, after Thomas and Johnston, *The Illusion of Life*, 1981 ([link][twelve]): "while \"pose to pose\" involves starting with drawing key frames, and then filling in the intervals later."
- **Ritmo:** "two or three" references and the poses written in words before code are the maintainer's direction for the skill; the clip's `about` is where the bank keeps what a clip is for, and the review page shows it to the person.

### One rig per character, one clip per game state, each on its stance

- Esoteric Software, Spine runtimes guide, "Runtime skeletons" ([link][spine-skeletons]): "Animations are applied relative to the setup pose."
- **Ritmo:** stances are named poses a clip starts and (played once) ends on, which the `stance` check holds it to, so the game can go from one clip to the next on a shared pose. Shared constants in the rig module's exports are how the example bank's clips share a grip and stances.

### Aims and reaches for the key poses

- Esoteric Software, Spine user guide, "IK constraints" ([link][spine-ik]), on the bend direction of a two-bone chain: "When checked, the child bone rotates in the positive direction (counterclockwise) relative to the parent bone."
- **Prototype:** "Every bone value is a turn from setup relative to its parent, but I reason about poses in world angles (\"sword pointing back and down\"). Every key needed hand arithmetic" … "An authoring helper that takes world angles (`aim: { sword: 245 }`, solved like IK) would remove most of my mistakes".
- **Ritmo:** `aim` (a world angle) and `reach` (two-bone IK to a point, or to a point on another bone) were built from that note, and the skill says to key extremes with them.

### Timing in phases; ease into extremes; the snap fast; the hold outside it; hit frames that travel forward

- Wikipedia, "Twelve basic principles" ([link][twelve]): "For this reason, more pictures are drawn near the beginning and end of an action, creating a slow in and slow out effect" … "Timing is critical for establishing a character's mood, emotion, and reaction."
- **Prototype:** "Getting slow-in and slow-out right was the main timing work."
- **Ritmo:** `rest: true` is how `rig.keys` eases into and out of an extreme; a `fast` phase is the one span the `jerk` check lets snap, and the default span of the bake's hit. So a wind-up hold inside the fast span is never checked for pops, and the default hit takes in a first fast frame where, in Borri's evaluation chop, the hips led and the axe still rose; `rig check` reports the hit's `travel` so the agent sees it and sets `hit.frames`.

### Anticipation before, follow-through after, the body leading

- Wikipedia, "Twelve basic principles" ([link][twelve]): "Anticipation is used to prepare the audience for an action, and to make the action appear more realistic." … "a golfer making a swing has to swing the club back first." … "\"Follow through\" means that loosely tied parts of a body should continue moving after the character has stopped" … "\"Overlapping action\" is the tendency for parts of the body to move at different rates" … "On the human body, the torso is the core, with arms, legs, head and hair appendices that normally follow the torso's movement." … "A third, related technique is \"drag\", where a character starts to move and parts of them take a few frames to catch up."
- Wikipedia, "Walk cycle" ([link][walk]): "In addition to the legs, the arms, hips, torso, and head must move together to make the walk feel natural and expressive."
- **Review**, punch, frame 4: "At the peek of the punch, the whole body is supposed to push forward a little more, shoulder and hips".

### Judge timing by spacing; follow a blade tip with positions; zoom and onion skin

- **Prototype:** "The `spacing` array and the per-frame world angle in the check were what let me fix timing without guessing. The zoom image and onion skin mattered more than the full sheet; at 1x a 20-frame row is too small to judge."
- **Review**, walk, frame 22: "The sword tip digs into the floor here while he walks."
- **Ritmo:** `--positions` prints a bone's start, tip, and angle on every frame, so the agent follows a blade tip or a hand without a picture.

### Check before showing; accept a warning only with a reason; resolve with a reply

- **Ritmo:** the same rules as `ritmo-fx` (see [`FX.md`](FX.md)): a judged exception is written down with why, errors are never waived, and each comment is closed with a reply the person reads beside it.

## Acting on the person's notes

### A pixel pin: its bone's keys around its frame

- **Ritmo:** a pin carries the part, its own bone, and the spot in that bone's frame, and `rig look` and the page ring it where the part is now, so the agent sees whether the change moved what the person meant.

### A span is timing: the keys first

- Wikipedia, "Twelve basic principles" ([link][twelve]): "Timing is critical for establishing a character's mood, emotion, and reaction."
- **Ritmo:** a span comment exists so a timing note is not pinned to a pixel; moving keys changes timing without changing the poses the person already approved.

### A dragged pivot is folded into the rig module

- **Ritmo:** the page saves a dragged pivot to the bank's `pivots`, laid over the module's like `tune` over params; the module stays the one source of truth, so the agent copies it in and clears the bank (the maintainer's direction, step 4 of the tool).

### "Too mechanical": lean, rock, straighten the legs at contacts

- **Review**, walk: "It looks too mechanic, the body may need to lean a little more and the leg to extend on the step instead of being always bended."
- Esoteric Software, Spine user guide, "Animating" ([link][spine-animating]): "When all the parts of a skeleton are moving at a constant speed, the movement tends to be robotic and lifeless."
- Wikipedia, "Walk cycle" ([link][walk]): "The main poses are contact, down, passing, and up, which control the character's weight, balance, and movement."

### "No lead-up": a settle before the raise

- **Review**, attack: "It does not have enough lead up to the animation, it just raises the arm out of nowhere."
- Wikipedia, "Twelve basic principles" ([link][twelve]), on anticipation: "a golfer making a swing has to swing the club back first."

### A note on how a move is really done is a reference

- **Review**, kick, frame 13: "When throwing a kick, the opposite hand here (and arm) is supposed to raise at the level of the head to cover it" … and on the near side: "the hand and arm on the same side usually extends a little following the leg movement". Block, frame 12: "I imagine this parrying on the front, the sword should be inclined in the other direction, like a cross in front of the character".
- Hugo, Sprite Fusion ([link][spritefusion]): "Your taste is built from your references."

### Only the person's `approved` says a clip is done; keep their tune and pivots

- Hugo, Sprite Fusion ([link][spritefusion]): "This is very important: it's on you to set the quality bar."
- **Ritmo:** the same rule as `ritmo-fx` and the other labs.

## In the game

### The sidecar decoded with the game's own Standard Schema

- **Ritmo:** "Ritmo exports no codec builders. Values are Standard Schemas the game brings." (the repo's API rules). `integration/brawler` decodes the example bank's sidecar this way.

### Clip and start step as saved state; the frame derived from `Clock`

- **Ritmo:** package and game code read time from `Clock` (the repo's rules, enforced by `pnpm lint`), and a value derived from saved state is not saved too: `integration/brawler` keeps `{ clip, started, landed }` and derives the frame on every step, and its tests replay a fight to the same frames.

### Hits on the sidecar's frames, once per play; sparks on sockets, footsteps on contacts

- **Ritmo:** the bake writes the hit, sockets, and contacts from the same poses as the sheet's pixels, so gameplay matches what the player sees; `integration/brawler` sweeps the hit and keeps `landed` so a swing hits once.

[spritefusion]: https://www.spritefusion.com/blog/how-to-make-good-pixel-art-effects-with-claude
[twelve]: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
[walk]: https://en.wikipedia.org/wiki/Walk_cycle
[spine-concepts]: https://esotericsoftware.com/spine-basic-concepts
[spine-skeletons]: https://esotericsoftware.com/spine-runtime-skeletons
[spine-ik]: https://esotericsoftware.com/spine-ik-constraints
[spine-animating]: https://esotericsoftware.com/spine-animating
