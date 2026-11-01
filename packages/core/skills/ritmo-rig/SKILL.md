---
name: ritmo-rig
description: "Apply whenever a game's characters are animated on a skeleton (side-view characters made of parts, about 64 px tall and up: an idle, a walk, attacks) and are made, changed, or reviewed with a person. Says when a rig fits, how to write a rig and its clips as code and check and look at them with `ritmo-tools rig`, open the review page, act on the person's notes, pins, and pivots, and how the game plays the bake."
---

# Characters on a skeleton with `ritmo-tools rig`

`ritmo-tools rig` keeps a character as code: a rig module (its bones, the parts drawn on them, its IK chains, props, and stances) and a few drafts of each clip, each a module that poses the rig on every frame. A bank file (`hero.rig.json`) names the rig module and every clip's drafts. It ships in `@typeonce/ritmo-tools`: run it as `npx @typeonce/ritmo-tools rig <command>`. Below, `rig <command>` stands for that; `rig <command> --help` lists every flag, and the package's README describes the modules, what a pose and `rig.keys` take, every check, and the bake's sidecar. Every command prints JSON and exits 0 (clean; warnings are your call), 2 (usage error, missing file, broken bank), or 3 (errors: fix them).

You cannot watch a clip play. You write poses, measure them, and look at still frames; the person watches and decides.

## When a rig fits

- **Side-view characters made of parts, about 64 px tall and up**, whose clips all reuse one set of parts: a fighter, a hero with a sword, a creature. The parts are drawn smooth (shapes, or pictures cut from a parts sheet with `rig parts`).
- **Not small pixel sprites.** A rig draws anti-aliased parts and keeps no pixel grid: a 16 or 32 px sprite and its frames stay with the pixel fixer (the `ritmo-pixel-art` skill).
- **Not the hand-drawn, frame-by-frame look.** Parts are flat side views, so a rig cannot twist the torso or turn the hips toward the camera. Choose moves that read from the side; a move that needs a turn is drawn frame by frame, not rigged.

## From a parts sheet

When the character comes as pictures (a parts sheet from an image generator or an artist: each part drawn whole and apart from the others, side view facing right, on a plain background), build the rig from it before any clip:

1. Name the parts in the sheet's reading order with the names `rig init --from` knows (`head`, `torso`, `upperArmNear`, `upperArmFar`, `forearmNear`, `forearmFar`, `handNear`, `handFar`, `thighNear`, `thighFar`, `shinNear`, `shinFar`, `footNear`, `footFar`; any other name becomes a prop held at the near hand) and cut it: `rig parts <sheet.png> -o parts --names <names>`. Read the report: a box left out as a label or a speck, or a count that differs from your names, means the sheet or the names are wrong, not the cut.
2. Check every guessed pivot in `parts/parts.json` against the picture before scaffolding. The rule puts a pivot on the joint nearest the body, which is wrong for a weapon lying on its side (its pivot belongs at the grip) and arbitrary for a round part like a fist; correct those in the file.
3. `rig init --from parts/parts.json`, then `rig look <bank> idle --art`: the character should stand assembled on the ground line. Fix bone lengths, part angles, and pivots in the rig module until it does, and only then write clips. A two-handed weapon needs the far hand's `reach` onto the haft in every clip that holds it.

## The loop

1. **References first.** Ask for, or find, two or three references of the real motion (a fighting game's move, a film, a video of someone doing it). Write each clip's key poses in words before any code, one line each ("settle: the weight sinks back, the tip dips; cocked: blade behind the head, held; strike: hips first, then the arms"). Put the move's purpose in the clip's `about`.
2. **One rig per character, one clip per game state** (idle, walk, attack, hurt), each declaring the `stance` it starts on, so the game can go from one clip to another on the pose they share. Put shared stances in the rig module's `stances` and shared constants (a grip, the feet's spots) in its named exports; clips import them.
3. **Key the poses, then the timing.** Pose a blade or a limb by its world angle (`aim`) and a hand or a foot by where it goes (`reach`: a fist from its shoulder, a hand on the grip), and the rest by turns. Time the clip in `phases`, marking the snap (a swing, a strike) `fast`; put `rest` on extremes and holds so the motion eases into and out of them, and `linear` only through the snap.
4. **Anticipation before, follow-through after.** A settle and a draw back before a raise; the body leading a strike (the hips and torso first, the arms catching up); after it, the arms and loose parts carrying on past the stop and settling back. The idle and the walk move the whole body, the head and arms a frame or two behind the hips.
5. **Check and look.** `rig check <bank>`: fix every error. Judge timing by the trail's `spacing` (small steps into and out of the extremes, big ones through the snap), and with `--positions <bones>` follow what a check does not watch on every frame (a blade tip near the floor, a hand on a grip). Then `rig look <bank> <clip> --frames <a-b> --scale 2 --onion` on the frames that matter: a zoomed few frames with the one before show more than the whole sheet. `--compare` weighs the drafts at the same moments. Accept a warning only when it is the look you want, with why. Fix and repeat before the person sees it.
6. **Open the review**: `rig review <bank>` (add `--host` for a phone; it runs until stopped, so start it in the background) and send the person the `url`. Tell them which clip to look at and what each draft tries.
7. **Read back** with `rig notes <bank>`, act on every note (below), and mark each comment done with `rig resolve <bank> <clip> <numbers...> --reply "what changed"`. Go back to 5. Drop drafts the person ruled out.

## Acting on the person's notes

- **A pixel pin**: change its bone's keys around its frame (the turn, aim, or reach that places it, or the channel of a parent that carries it), then `rig look --frames <frame>`: the ring follows the part, so you see whether the spot went where they meant.
- **A span** is timing ("frames 6-9 feel slow"): move the keys inside it closer or farther apart, or change the clip's `frames`, before changing any pose.
- **A pivot** the person dragged: fold it into the rig module as `notes`' `next` says, in the same round, then `rig look --art` to see the part sit on its joint.
- **"Too mechanical", "stiff"**: lean the body into the move, rock the hips and torso a few degrees with each step, and straighten the leg at each contact instead of keeping it bent.
- **"No lead-up", "out of nowhere"**: add a settle before the raise: the weight sinks and draws back first, then the move.
- **A note on how the move is really done** ("in a kick the other arm covers the head", "at the punch's peak the hips and shoulder push forward") is a reference: follow it over your first draft, and keep it for the other clips.
- Never call a clip done because it checks clean: only the person's `approved` says it looks right. Keep their `tune` and `pivots` when you change a draft; fold them into the modules when they agree.

## In the game

- Bake with `rig bake <bank> -o <dir>` into the game's assets: the sheets and atlases for the renderer, and the sidecar for the simulation, decoded once at startup with the game's own Standard Schema.
- Which clip plays and the step it started on are simulation state, saved with the rest; the frame is derived from `Clock` in each system that needs it, never stored or counted, so a replay or a load shows the same frame. A clip change is a new start step.
- Gameplay reads the sidecar's frames, never the sheet's pixels: a swing hits once per play (keep that it landed in the clip's state), a spark spawns on a `sockets` point, a footstep plays where a foot joins `contacts`. Rebake after every approved change: the sidecar and the sheets move together.
